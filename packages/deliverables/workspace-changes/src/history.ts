/**
 * Repository history reads for the Files workbench: the refs its history
 * filter offers, one page of a ref's commits, one commit's message and changed
 * files, and one commit file's comparison with the commit's first parent.
 *
 * Commands run with an argv array and literal pathspecs. The diff reads disable
 * external diff drivers and textconv, so a workspace-writable `.git/config` or
 * `.gitattributes` cannot make them execute a host program, and metadata reads
 * disable signature display and notes so repository configuration cannot
 * change the parsed fields. Paths come back relative to the repository root and
 * are filtered to the Session working directory before they reach a view.
 */
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { GitRunner, GitRunResult } from './git.ts'
import { parseNumstatRecords } from './numstat.ts'
import { parsePatch } from './patch.ts'
import {
  canonicalPath, compareDisplay, displayPathOf, isInside, toPosix, underPrefix,
} from './paths.ts'
import type {
  WorkspaceFileDiff, WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitCommitDiffRequest,
  WorkspaceGitCommitFile, WorkspaceGitHistory, WorkspaceGitHistoryRequest, WorkspaceGitRef,
} from './types.ts'

/** Bounds the history reads share with the worktree reads. */
export interface HistoryLimits {
  /** Commits one page carries; a larger request is clamped to it. */
  maxCommits: number
  /** Changed files one commit detail carries; `total` still reports the complete count. */
  maxFiles: number
  /** Bytes of file content the patch output cap scales with; a larger patch is reported oversized. */
  maxFileBytes: number
  /** Bytes one git command may collect before its output is refused as truncated. */
  outputMaxBytes: number
}

/** One commit per NUL-terminated record, with NUL-separated fields refreshed from `git log --format`. */
const LOG_FORMAT = '%H%x00%h%x00%P%x00%an%x00%aI%x00%s'

/** One commit record carrying the same fields as {@link LOG_FORMAT} plus the raw message body. */
const SHOW_FORMAT = '%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00%B'

/** One ref per line, with NUL-separated fields; `%(HEAD)` marks the checked-out branch. */
const REF_FORMAT = '%(refname)%00%(objectname)%00%(*objectname)%00%(HEAD)%00%(objecttype)%00%(*objecttype)'

/** Full git object ids this package accepts as a commit name; the route checks the same form. */
const COMMIT_HASH = /^[0-9a-f]{4,64}$/u

/** The diff flags every patch read shares: no color, no external driver, no textconv, fixed prefixes. */
const PATCH_FLAGS = [
  '-M', '-U3', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative',
  '--src-prefix=a/', '--dst-prefix=b/',
] as const

/** The tree-read flags every file listing shares: recursion, rename detection, NUL records, no external programs. */
const TREE_FLAGS = ['-r', '-M', '-z', '--no-ext-diff', '--no-textconv', '--no-relative'] as const

/**
 * Reject a git read that failed or lost output to its byte cap.
 * @param result - settled command facts.
 * @param what - description of the read for the error message.
 * @returns the same result when it exited zero within the cap.
 */
function read(result: GitRunResult, what: string): GitRunResult {
  if (result.exitCode !== 0) throw new Error(`${what} failed: ${result.stderr.trim()}`)
  if (result.truncated) throw new Error(`${what} output exceeded the configured cap`)
  return result
}

/**
 * Split a `-z`-terminated git output whose records carry a fixed number of NUL-separated fields.
 * @param output - complete stdout; every record ends with NUL.
 * @param fields - field count one record carries.
 * @returns the fields of every record, in output order.
 */
function records(output: string, fields: number): string[][] {
  const parts = output.split('\0')
  if (parts.at(-1) !== '') throw new Error('git output is not NUL-terminated')
  parts.pop()
  if (parts.length % fields !== 0) throw new Error('git output holds a malformed record')
  const split: string[][] = []
  for (let at = 0; at < parts.length; at += fields) split.push(parts.slice(at, at + fields))
  return split
}

/** The Session working directory's place in its repository. */
interface RepositoryLocation {
  /** Repository top-level directory, the root every diff path is relative to. */
  root: string
  /** The working directory's repository-relative prefix with a trailing slash, or empty at the root. */
  prefix: string
}

/**
 * Locate the repository and resolve one commit in the same command.
 *
 * `--verify` applies to the trailing revision, so the output carries the
 * top-level directory and the working directory's prefix first and the
 * resolved commit id last.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param hash - full or abbreviated commit id.
 * @param signal - the request's cancellation.
 * @returns where the repository is and which commit `hash` names, or undefined
 *   when `hash` names no commit.
 * @throws when git cannot read the repository.
 */
async function locateCommit(
  git: GitRunner, cwd: string, hash: string, signal: AbortSignal,
): Promise<{ location: RepositoryLocation; resolved: string } | undefined> {
  if (!COMMIT_HASH.test(hash)) return undefined
  const result = await git.run([
    'rev-parse', '--show-toplevel', '--show-prefix', '--verify', '--quiet', `${hash}^{commit}`,
  ], { cwd, signal })
  // A revision that names nothing exits 1 after printing where the repository
  // is; any other failure means the repository itself could not be read.
  if (result.exitCode === 1) return undefined
  if (result.exitCode !== 0) throw new Error(`git rev-parse in ${cwd} failed: ${result.stderr.trim()}`)
  if (result.truncated) throw new Error(`git rev-parse in ${cwd} output exceeded the configured cap`)
  const lines = result.stdout.split('\n')
  const resolved = lines[2]?.trim()
  /* v8 ignore next -- a verified revision always prints its resolved id. */
  if (resolved === undefined || resolved === '') throw new Error(`git rev-parse in ${cwd} printed no commit`)
  return { location: { root: lines[0] as string, prefix: lines[1] ?? '' }, resolved }
}

/**
 * Resolve one revision to its object id.
 * @param git - command runner.
 * @param cwd - directory inside the repository.
 * @param revision - the revision to verify.
 * @param signal - the request's cancellation.
 * @returns the object id, or undefined when the revision names nothing.
 * @throws when git cannot read the repository.
 */
async function verifyRev(
  git: GitRunner, cwd: string, revision: string, signal: AbortSignal,
): Promise<string | undefined> {
  const result = await git.run(['rev-parse', '--verify', '--quiet', revision], { cwd, signal })
  if (result.exitCode === 0) return result.stdout.trim()
  // Verification reports a missing object with exit code 1; any other failure
  // means the repository itself could not be read.
  if (result.exitCode !== 1) throw new Error(`git rev-parse in ${cwd} failed: ${result.stderr.trim()}`)
  return undefined
}

/**
 * The first parent of one commit.
 * @param git - command runner.
 * @param cwd - directory inside the repository.
 * @param commit - full commit hash.
 * @param signal - the request's cancellation.
 * @returns the first parent's full hash, or undefined for the root commit.
 * @throws when git cannot read the commit.
 */
async function firstParent(git: GitRunner, cwd: string, commit: string, signal: AbortSignal): Promise<string | undefined> {
  return verifyRev(git, cwd, `${commit}^`, signal)
}

/**
 * Split one `--raw --numstat` tree listing into its two sections.
 *
 * git prints the raw block first, one record per changed path: a `:`-prefixed
 * header, the destination path, and — for a rename — the origin. The
 * numstat block follows, and its records begin with a count, never a colon, so
 * the two sections split without guessing at either format.
 *
 * A copy record (`C`) carries the same extra origin field, and the parse keeps
 * that branch although `-M` alone never emits one: only `-C` enables copy
 * detection, so the branch guards the record format rather than serving a
 * reachable status.
 * @param output - complete stdout of `git diff-tree -r -M -z --raw --numstat`.
 * @returns the status letter of every changed destination path, and the raw
 *   numstat records that follow it.
 * @throws when a record is malformed, which indicates truncated output.
 */
function splitTreeListing(output: string): { statuses: Map<string, string>; numstat: string[] } {
  const records = output.split('\0')
  if (records.at(-1) !== '') throw new Error('git diff-tree output is not NUL-terminated')
  records.pop()
  const statuses = new Map<string, string>()
  let at = 0
  while (at < records.length && (records[at] as string).startsWith(':')) {
    const record = records[at++] as string
    const letter = record.charAt(record.lastIndexOf(' ') + 1)
    const path = records[at++]
    if (path === undefined) throw new Error('git diff-tree raw output holds a malformed record')
    if (letter === 'R' || letter === 'C') {
      const destination = records[at++]
      if (destination === undefined) throw new Error('git diff-tree raw output holds a malformed record')
      statuses.set(destination, letter)
      continue
    }
    statuses.set(path, letter)
  }
  return { statuses, numstat: records.slice(at) }
}

/**
 * The entry kind one raw status letter describes.
 * @param letter - first character of a raw diff status.
 * @returns the kind the history view names.
 */
function entryKind(letter: string): WorkspaceGitCommitFile['kind'] {
  if (letter === 'A') return 'added'
  if (letter === 'D') return 'deleted'
  if (letter === 'R' || letter === 'C') return 'renamed'
  return 'modified'
}

/**
 * Parse one NUL-terminated log record set into commits.
 * @param output - complete stdout of a {@link LOG_FORMAT} `git log -z` run.
 * @returns commits in the order git printed them.
 * @throws when the record set is malformed, which indicates truncated output.
 */
function parseLog(output: string): WorkspaceGitCommit[] {
  return records(output, 6).map(([hash, short, parents, author, authoredAt, subject]) => ({
    hash: hash as string,
    short: short as string,
    parents: parents === '' ? [] : (parents as string).split(' '),
    author: author as string,
    authoredAt: authoredAt as string,
    subject: subject as string,
  }))
}

/** Prefix stripped from each ref kind's full name. */
const REF_PREFIX: Readonly<Record<WorkspaceGitRef['kind'], string>> = {
  local: 'refs/heads/',
  remote: 'refs/remotes/',
  tag: 'refs/tags/',
}

/**
 * Parse one ref listing.
 * @param output - complete stdout of a {@link REF_FORMAT} `git for-each-ref` run.
 * @returns refs in git's order, without a remote's symbolic `HEAD` and without
 *   a tag whose peeled target is not a commit.
 * @throws when a record is malformed, which indicates truncated output.
 */
function parseRefs(output: string): WorkspaceGitRef[] {
  if (output === '') return []
  if (!output.endsWith('\n')) throw new Error('git for-each-ref output is not newline-terminated')
  const refs: WorkspaceGitRef[] = []
  for (const line of output.slice(0, -1).split('\n')) {
    const fields = line.split('\0')
    if (fields.length !== 6) throw new Error('git for-each-ref output holds a malformed record')
    const [refname, objectname, peeled, head, objectType, peeledType] = fields as [string, string, string, string, string, string]
    // A remote's HEAD is a symbolic ref to another branch, not a branch of its own.
    if (refname.startsWith('refs/remotes/') && refname.endsWith('/HEAD')) continue
    // A tag may point at a tree or a blob; walking one would list no commits,
    // which reads as an empty repository, so it is not offered.
    if ((peeled === '' ? objectType : peeledType) !== 'commit') continue
    const kind = refname.startsWith('refs/heads/') ? 'local'
      : refname.startsWith('refs/remotes/') ? 'remote'
        : 'tag'
    const name = refname.slice(REF_PREFIX[kind].length)
    refs.push({
      name,
      refname,
      kind,
      // An annotated tag's own object id names the tag object; the peeled id names the commit.
      hash: peeled === '' ? objectname : peeled,
      ...(head === '*' ? { head: true } : {}),
    })
  }
  return refs
}

/**
 * Whether each side of a two-way patch exists, read from its file headers.
 * Only the header run between `diff --git` and the first `@@` is read: a
 * hunk body may hold a removed content line that spells `-- /dev/null` and
 * would otherwise be read as the old-side header.
 * A pure rename or mode change prints neither side as `/dev/null`, so both
 * sides start out present.
 * @param output - decoded `git diff` output.
 * @returns whether the old side and the new side exist.
 */
function patchSides(output: string): { before: boolean; after: boolean } {
  let before = true
  let after = true
  let header = false
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) header = true
    else if (line.startsWith('@@')) header = false
    else if (header && line.startsWith('--- ')) before = line.slice(4) !== '/dev/null'
    else if (header && line.startsWith('+++ ')) after = line.slice(4) !== '/dev/null'
  }
  return { before, after }
}

/** Full ref names a history walk accepts: the three namespaces {@link historyRefs} lists. */
const HISTORY_REF = /^refs\/(?:heads|remotes|tags)\/\S/u

/**
 * Whether one name is a ref a history walk may name.
 * @param git - command runner.
 * @param cwd - directory inside the repository.
 * @param ref - the requested ref name.
 * @param signal - the request's cancellation.
 * @returns true when the name is a full ref of a listed namespace and resolves to a commit.
 * @throws when git cannot read the repository.
 */
async function walkableRef(git: GitRunner, cwd: string, ref: string, signal: AbortSignal): Promise<boolean> {
  return HISTORY_REF.test(ref) && await verifyRev(git, cwd, `${ref}^{commit}`, signal) !== undefined
}

/**
 * List the refs a history view can walk.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param signal - the request's cancellation.
 * @returns local branches, remote branches, and tags in git's order, with annotated tags peeled to their commits.
 * @throws when git cannot answer or its listing was truncated.
 */
export async function historyRefs(git: GitRunner, cwd: string, signal: AbortSignal): Promise<readonly WorkspaceGitRef[]> {
  const found = read(await git.run([
    'for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags',
  ], { cwd, signal }), `git for-each-ref in ${cwd}`)
  return parseRefs(found.stdout)
}

/**
 * Read one page of a ref's history.
 *
 * The requested ref must be one {@link historyRefs} lists; an absent ref walks
 * `HEAD`. A repository without commits has no page to show and answers an
 * empty page rather than failing.
 *
 * The walk is topological, so every commit follows all of its children: the
 * lane layout that draws the page needs a parent to arrive after the rows that
 * reach it. A topological walk reads the commit graph rather than stopping at
 * the page's last commit, so its cost follows the repository's history instead
 * of the page size; git answers it from the commit-graph file that `git clone`,
 * `git gc`, and `git commit-graph write` produce, and a repository without one
 * pays a full walk per page.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param request - the ref to walk, the commits to skip, and the page size.
 * @param signal - the request's cancellation.
 * @param limits - the page-size cap.
 * @returns the page in topological order, newest first, with at most the capped page size.
 * @throws when the ref is foreign, the page coordinates are invalid, or git cannot answer.
 */
export async function history(
  git: GitRunner, cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal, limits: HistoryLimits,
): Promise<WorkspaceGitHistory> {
  const { skip, limit: requested } = request
  if (!Number.isSafeInteger(skip) || skip < 0) throw new Error('history skip must be a non-negative safe integer')
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('history limit must be a positive safe integer')
  const limit = Math.min(requested, limits.maxCommits)
  const ref = request.ref
  // An absent ref walks `HEAD` and needs no check. A named one must be a full
  // ref that resolves to a commit, so a request cannot walk an arbitrary
  // revision; one `rev-parse` answers that without listing every ref the
  // filter already holds. The walk names the full ref, because a bare name
  // that a branch and a tag share resolves ambiguously instead of to the
  // picked ref. The leading-dash guard keeps an option-like name out of git,
  // and `--end-of-options` before the revision keeps a future caller's
  // option-like name inert too: the `--` that ends the pathspec list does not
  // end option parsing for a revision.
  if (ref !== undefined && (ref.startsWith('-') || !(await walkableRef(git, cwd, ref, signal)))) {
    throw new Error(`history ref ${ref} is not one of the repository's refs`)
  }
  const found = await git.run([
    'log', '-z', '--no-color', '--no-decorate', '--no-show-signature', '--no-notes', '--topo-order',
    `--skip=${skip}`, `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`,
    // `--end-of-options` is what keeps a revision that begins with a dash out
    // of option parsing; `--` only separates the revision from pathspecs.
    ...(ref === undefined ? [] : ['--end-of-options', ref]), '--',
  ], { cwd, signal })
  if (found.exitCode !== 0) {
    // An unborn branch has no revision to walk; the repository itself is fine.
    if (ref === undefined && !(await hasHeadCommit(git, cwd, signal))) return { commits: [], hasMore: false }
    throw new Error(`git log in ${cwd} failed: ${found.stderr.trim()}`)
  }
  if (found.truncated) throw new Error(`git log in ${cwd} output exceeded the configured cap`)
  const commits = parseLog(found.stdout)
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
}

/**
 * Whether `HEAD` names a commit.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param signal - the request's cancellation.
 * @returns true when the repository has a commit checked out.
 * @throws when git cannot read the repository, so a broken `HEAD` is not
 *   reported as an unborn branch.
 */
async function hasHeadCommit(git: GitRunner, cwd: string, signal: AbortSignal): Promise<boolean> {
  return await verifyRev(git, cwd, 'HEAD^{commit}', signal) !== undefined
}

/**
 * Read one commit's message and changed files.
 *
 * The file list is the commit's diff against its first parent, which also
 * covers a merge commit; a root commit is compared against the empty tree. Paths
 * outside the Session working directory are dropped, and the old path of a
 * rename is served only when it lies inside the working directory too.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param hash - the commit to read, full or abbreviated.
 * @param signal - the request's cancellation.
 * @param limits - the file cap.
 * @returns the commit, or undefined when `hash` names no commit.
 * @throws when git cannot answer or its output was truncated.
 */
export async function commit(
  git: GitRunner, cwd: string, hash: string, signal: AbortSignal, limits: HistoryLimits,
): Promise<WorkspaceGitCommitDetail | undefined> {
  const found = await locateCommit(git, cwd, hash, signal)
  if (found === undefined) return undefined
  const { location, resolved } = found
  const shown = read(await git.run([
    'show', '-s', '-z', '--no-color', '--no-decorate', '--no-show-signature', '--no-notes',
    `--format=${SHOW_FORMAT}`, resolved,
  ], { cwd: location.root, signal }), `git show in ${cwd}`)
  const [record] = records(shown.stdout, 7)
  if (record === undefined) throw new Error(`git show in ${cwd} printed no commit`)
  const [full, short, parentsField, author, authoredAt, subject, body] = record as [
    string, string, string, string, string, string, string,
  ]
  // `%B` carries the message's final newline; the view wants the stored message without it.
  const message = body.endsWith('\n') ? body.slice(0, -1) : body
  const parents = parentsField === '' ? [] : parentsField.split(' ')
  const range = parents.length === 0 ? ['--root', full] : [parents[0] as string, full]
  // One tree walk serves both blocks: git prints the raw section and then the
  // numstat section, so the status letters and the line counts share a read.
  const listing = splitTreeListing(read(await git.run([
    'diff-tree', '--no-commit-id', ...TREE_FLAGS, '--raw', '--numstat', ...range,
  ], { cwd: location.root, signal }), `git diff-tree in ${cwd}`).stdout)
  const files: WorkspaceGitCommitFile[] = []
  for (const entry of parseNumstatRecords(listing.numstat)) {
    const path = underPrefix(entry.path, location.prefix)
    if (path === undefined) continue
    const from = entry.oldPath === undefined ? undefined : underPrefix(entry.oldPath, location.prefix)
    files.push({
      path: toPosix(path),
      display: toPosix(path),
      kind: entryKind(listing.statuses.get(entry.path) ?? 'M'),
      ...(from === undefined ? {} : { from: toPosix(from) }),
      added: entry.added,
      deleted: entry.deleted,
      ...(entry.binary ? { binary: true } : {}),
    })
  }
  const ordered = files.sort(compareDisplay)
  return {
    commit: { hash: full, short, parents, author, authoredAt, subject },
    message,
    files: ordered.slice(0, limits.maxFiles),
    total: ordered.length,
  }
}

/**
 * Compare one commit file with the commit's first parent.
 *
 * A root commit is compared against the empty tree. The path and a rename's
 * origin must stay inside the Session working directory, including through a
 * symbolic link; both are mapped to literal pathspecs relative to the
 * repository root.
 * @param git - command runner.
 * @param cwd - the Session working directory.
 * @param request - the commit, the path to compare, and a rename origin.
 * @param signal - the request's cancellation.
 * @param limits - the patch output cap.
 * @returns the comparison, or undefined when a path leaves the working directory (directly or
 *   through a symbolic link), the commit is unknown, or the path has nothing to compare.
 * @throws when git fails to produce the comparison.
 */
export async function commitDiff(
  git: GitRunner, cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal, limits: HistoryLimits,
): Promise<WorkspaceFileDiff | undefined> {
  const { hash, path, from } = request
  if (path === '') return undefined
  const absolute = resolve(cwd, path)
  if (!isInside(cwd, absolute)) return undefined
  if (from !== undefined && (from === '' || !isInside(cwd, resolve(cwd, from)))) return undefined
  // A directory link inside the workspace must not lead the read outside it,
  // as the working-tree comparison already enforces.
  if (!isInside(await canonicalPath(cwd), await canonicalPath(dirname(absolute)))) return undefined
  const located = await locateCommit(git, cwd, hash, signal)
  if (located === undefined) return undefined
  const { location, resolved } = located
  const parent = await firstParent(git, location.root, resolved, signal)
  const repoPath = `${location.prefix}${toPosix(path)}`
  // GIT_LITERAL_PATHSPECS makes these plain paths literal, so metacharacters
  // in a file name select the path itself and pathspec magic stays inert.
  const specs = from === undefined ? [repoPath] : [`${location.prefix}${toPosix(from)}`, repoPath]
  // The cap scales with the file content the view may draw, like the worktree comparison's.
  const maxBytes = Math.min(limits.outputMaxBytes, limits.maxFileBytes * 3 + 64 * 1024)
  const environment = { GIT_LITERAL_PATHSPECS: '1' }
  const found = parent === undefined
    ? await git.run([
      'diff-tree', '--root', '--no-commit-id', ...PATCH_FLAGS, resolved, '--', ...specs,
    ], { cwd: location.root, env: environment, signal, maxBytes })
    : await git.run([
      'diff', ...PATCH_FLAGS, parent, resolved, '--', ...specs,
    ], { cwd: location.root, env: environment, signal, maxBytes })
  if (found.exitCode !== 0) throw new Error(`git diff in ${cwd} failed: ${found.stderr.trim()}`)
  const display = displayPathOf(absolute, cwd, location.root, homedir())
  const relative = toPosix(path)
  if (found.truncated) return { kind: 'oversized', path: relative, display }
  if (found.stdout === '') return undefined
  const parsed = parsePatch(found.stdout)
  if (parsed.binary) return { kind: 'binary', path: relative, display }
  const sides = patchSides(found.stdout)
  return { kind: 'text', path: relative, display, before: sides.before, after: sides.after, hunks: parsed.hunks, coarse: false }
}
