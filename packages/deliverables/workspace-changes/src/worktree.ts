/**
 * The Session working tree's git state and per-file comparisons against
 * `HEAD`, read through the configured filesystem and subprocess providers.
 *
 * Status comes from one `git status --porcelain=v1 --branch -z
 * --untracked-files=all -- .` run scoped to the Session working directory.
 * Status paths are relative to the repository root, so the cwd prefix git
 * reports is stripped before they reach the view. A comparison is git's own
 * patch for the path: renames, end-of-line and clean/smudge conversions, and
 * symbolic links read the way git reads them, so a link is compared by its
 * text rather than by the file it points at. The line comparison the turn
 * recorder uses therefore does not apply here, and `coarse` is always false.
 *
 * The reads run no repository-configured programs: the status probe disables
 * `core.fsmonitor`, and the comparisons disable external diff drivers and
 * textconv. A workspace-writable `.git/config` or `.gitattributes` therefore
 * cannot make these commands execute a host program.
 */
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { GitRunner } from './git.ts'
import { parsePatch } from './patch.ts'
import { canonicalPath, compareDisplay, displayPathOf, isInside, toPosix, underPrefix } from './paths.ts'
import type {
  WorkspaceFileDiff, WorkspaceGitDiffRequest, WorkspaceGitEntry, WorkspaceGitStatus,
} from './types.ts'

/** Bounds the worktree reads share with the turn recorder. */
export interface WorktreeLimits {
  /** Changed entries one status read carries; `total` still reports the complete count. */
  maxFiles: number
  /** Bytes a file may hold to be compared; a larger one is listed without lines. */
  maxFileBytes: number
  /** Bytes one diff command may collect before its comparison is refused as oversized. */
  outputMaxBytes: number
}

/** Status characters git puts before a path, mapped to the entry kinds the view names. */
const STATUS_KIND: Readonly<Record<string, WorkspaceGitEntry['kind']>> = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'modified',
  U: 'modified',
}

/**
 * One `git status --porcelain=v1 --branch -z` output split into its branch and
 * entries.
 *
 * In `-z` form every record ends with NUL, and a rename or copy record carries
 * the original path as its own NUL-terminated field, which the parser consumes
 * so it never reads a path as a status line.
 *
 * git reports one path twice when its index entry is deleted but the file
 * remains untracked (`D  f` plus `?? f`). The tracked record is kept, because
 * the view's comparison against `HEAD` is the deletion that record describes;
 * the untracked record's comparison would show the same deletion under an
 * untracked label.
 * @param output - the command's NUL-separated stdout.
 * @param prefix - the working directory's repository-relative prefix, with a trailing slash, or empty at the root.
 * @returns the branch when git reported one, and one entry per path inside the working directory.
 */
export function parsePorcelain(output: string, prefix: string): { branch?: string; entries: WorkspaceGitEntry[] } {
  const records = output.split('\0')
  let branch: string | undefined
  const entries: WorkspaceGitEntry[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as string
    if (record === '') continue
    if (record.startsWith('## ')) {
      const header = record.slice(3).trim()
      // `main...origin/main`, `HEAD (no branch)`, or `No commits yet on main`.
      const name = header.startsWith('No commits yet on ') ? header.slice('No commits yet on '.length)
        : header.startsWith('HEAD (no branch)') ? undefined
          : header.split('...')[0]
      branch = name
      continue
    }
    const indexStatus = record.charAt(0)
    const worktreeStatus = record.charAt(1)
    // A rename or copy puts the original path in the next field.
    const renamed = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C'
    // A truncated record ends at the rename field; without an origin the entry
    // keeps its new path alone.
    const from = renamed ? records[index + 1] ?? '' : undefined
    if (renamed) index += 1
    if (indexStatus === '!') continue
    const path = underPrefix(record.slice(3), prefix)
    if (path === undefined || path === '') continue
    const origin = from === undefined || from === '' ? undefined : underPrefix(from, prefix)
    // A rename keeps its letter when the worktree also changed its content:
    // the origin is what makes the entry differ from a modified path.
    const kind = renamed ? 'renamed'
      : worktreeStatus === '?' ? 'untracked'
        : STATUS_KIND[worktreeStatus] ?? STATUS_KIND[indexStatus] ?? 'modified'
    entries.push({
      path: toPosix(path),
      display: toPosix(path),
      kind,
      ...(origin === undefined || origin === '' ? {} : { from: toPosix(origin) }),
    })
  }
  const byPath = new Map<string, WorkspaceGitEntry>()
  for (const entry of entries) {
    const held = byPath.get(entry.path)
    if (held === undefined || held.kind === 'untracked') byPath.set(entry.path, entry)
  }
  const unique = [...byPath.values()].sort(compareDisplay)
  return { ...(branch === undefined ? {} : { branch }), entries: unique }
}

/**
 * Read the working tree's git state for one directory.
 * @param git - resolved git runner, or null when git is unavailable.
 * @param cwd - the Session working directory.
 * @param signal - the request's cancellation.
 * @param limits - the entry cap.
 * @returns the repository state, or why the view has nothing to show.
 */
export async function worktreeStatus(
  git: GitRunner | null, cwd: string, signal: AbortSignal, limits: WorktreeLimits,
): Promise<WorkspaceGitStatus> {
  if (git === null) return { kind: 'unavailable', entries: [], total: 0 }
  const probe = await git.run(['rev-parse', '--is-inside-work-tree', '--show-prefix'], { cwd, signal })
  if (probe.exitCode !== 0) {
    return /not a git repository/i.test(probe.stderr)
      ? { kind: 'not-a-repository', entries: [], total: 0 }
      : { kind: 'unavailable', entries: [], total: 0 }
  }
  const lines = probe.stdout.split('\n')
  // A bare repository and a directory inside `.git` answer `false` without failing.
  if (lines[0] !== 'true') return { kind: 'not-a-repository', entries: [], total: 0 }
  /* v8 ignore next -- git prints `--show-prefix` on its own line after `--is-inside-work-tree`. */
  const prefix = lines[1] ?? ''
  const status = await git.run([
    '-c', 'core.fsmonitor=false',
    'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all', '--', '.',
  ], { cwd, signal })
  // A truncated listing would silently drop changed paths.
  if (status.exitCode !== 0 || status.truncated) return { kind: 'unavailable', entries: [], total: 0 }
  const parsed = parsePorcelain(status.stdout, prefix)
  return {
    kind: 'repository',
    ...(parsed.branch === undefined ? {} : { branch: parsed.branch }),
    entries: parsed.entries.slice(0, limits.maxFiles),
    total: parsed.entries.length,
  }
}

/**
 * Compare one working-tree path with its `HEAD` content.
 *
 * A path `HEAD` holds is compared with `git diff HEAD`; one it does not hold,
 * as for an untracked file or a repository without commits, is compared
 * against `/dev/null`. A rename passes both paths so git pairs them and the
 * old side is the origin's `HEAD` content.
 * @param git - resolved git runner.
 * @param fs - the filesystem provider that sees the working tree.
 * @param cwd - the Session working directory.
 * @param request - the changed path and, for a rename or copy, its original path.
 * @param signal - the request's cancellation.
 * @param limits - comparison bounds.
 * @returns the comparison, or undefined for a path outside the working directory or one git cannot read.
 * @throws when git fails to produce the comparison.
 */
export async function worktreeDiff(
  git: GitRunner, fs: FileSystem, cwd: string, request: WorkspaceGitDiffRequest,
  signal: AbortSignal, limits: WorktreeLimits,
): Promise<WorkspaceFileDiff | undefined> {
  const { path, from } = request
  const absolute = resolve(cwd, path)
  if (!isInside(cwd, absolute) || (from !== undefined && !isInside(cwd, resolve(cwd, from)))) return undefined
  // A directory link inside the workspace must not lead the read outside it.
  if (!isInside(await canonicalPath(cwd), await canonicalPath(dirname(absolute)))) return undefined
  const relative = toPosix(path)
  const display = displayPathOf(absolute, cwd, cwd, homedir())
  // HEAD holds the old side only when a blob sits at the path; a directory or a
  // repository without commits has none.
  const head = await git.run(['ls-tree', '-z', '-l', 'HEAD', '--', from ?? path], {
    cwd, signal, env: { GIT_LITERAL_PATHSPECS: '1' },
  })
  const staged = head.exitCode === 0 ? /^\d+ blob [0-9a-f]+ +(\d+)\t/u.exec(head.stdout) : null
  const before = staged !== null
  if (staged !== null && Number(staged[1]) > limits.maxFileBytes) {
    return { kind: 'oversized', path: relative, display }
  }
  // lstat reads the path itself, so a symbolic link is sized and compared by its text rather than its target.
  const info = await fs.lstat(path, { cwd }, signal)
  const after = info !== undefined && (info.type === 'file' || info.type === 'symlink')
  if (info?.type === 'file' && info.size !== undefined && info.size > limits.maxFileBytes) {
    return { kind: 'oversized', path: relative, display }
  }
  const maxBytes = Math.min(limits.outputMaxBytes, limits.maxFileBytes * 3 + 64 * 1024)
  let patch: { stdout: string; truncated: boolean }
  if (before) {
    const specs = (from === undefined ? [path] : [from, path]).map(value => `:(literal)${value}`)
    const result = await git.run([
      'diff', 'HEAD', '-M', '-U3', '--no-color', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', '--', ...specs,
    ], { cwd, signal, maxBytes })
    if (result.exitCode !== 0) throw new Error(`git diff in ${cwd} failed: ${result.stderr.trim()}`)
    patch = result
  } else if (after) {
    const result = await git.run([
      'diff', '--no-index', '-U3', '--no-color', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', '--', '/dev/null', path,
    ], { cwd, signal, maxBytes })
    // --no-index exits 1 when the paths differ, which is the comparison the view
    // asked for; a difference always writes a patch, so exit 1 without one is a
    // failed read, as for a link to a directory.
    if (result.exitCode === 1 && result.stdout === '') {
      throw new Error(`git diff --no-index in ${cwd} failed: ${result.stderr.trim()}`)
    }
    /* v8 ignore next -- a failure needs a path the process cannot read, which a test host running as root can read anyway. */
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`git diff --no-index in ${cwd} failed: ${result.stderr.trim()}`)
    }
    patch = result
  } else {
    return { kind: 'text', path: relative, display, before: false, after: false, hunks: [], coarse: false }
  }
  if (patch.truncated) return { kind: 'oversized', path: relative, display }
  const parsed = parsePatch(patch.stdout)
  if (parsed.binary) return { kind: 'binary', path: relative, display }
  return { kind: 'text', path: relative, display, before, after, hunks: parsed.hunks, coarse: false }
}
