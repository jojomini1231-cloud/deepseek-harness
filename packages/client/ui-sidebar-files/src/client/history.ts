/**
 * Pure helpers of the history view: how a commit's refs reach the inline
 * pills, how a commit's changed file is chosen for the comparison, and how its
 * timestamps read in the locale.
 *
 * The relative-time bucketing itself belongs to the shared primitive; this
 * module only maps a bucket through this package's dictionary, so the view
 * states "3 hours ago" exactly as the rest of the client does.
 */
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitCommitFile, WorkspaceGitRef,
} from '@deepseek-ai/dsh-workspace-changes/types'
import type {} from './locales.ts'

/** One commit's inline ref labels: at most `max` names, plus how many were left out. */
export interface CommitRefPills {
  /** The refs drawn as pills, the current branch first. */
  readonly shown: readonly WorkspaceGitRef[]
  /** Refs omitted after the cap, drawn as the `+n` pill when greater than zero. */
  readonly more: number
}

/** Row order inside one commit's pill list: the attached branch, then locals, remotes, tags. */
const REF_RANK: Readonly<Record<WorkspaceGitRef['kind'], number>> = {
  local: 1,
  remote: 2,
  tag: 3,
}

/** Order one commit's refs for its pills. */
function compareRefs(left: WorkspaceGitRef, right: WorkspaceGitRef): number {
  const rank = (ref: WorkspaceGitRef): number => ref.head === true ? 0 : REF_RANK[ref.kind]
  const byRank = rank(left) - rank(right)
  return byRank !== 0 ? byRank : left.name.localeCompare(right.name)
}

/**
 * The ref the history list follows before the reader picks one: the local
 * branch `HEAD` is attached to. A detached `HEAD` reports no such branch, and
 * the list then walks `HEAD` across all refs.
 * @param refs - the refs the repository reports.
 * @returns the attached branch's full ref name, or undefined for all refs.
 */
export function attachedBranch(refs: readonly WorkspaceGitRef[]): string | undefined {
  return refs.find(ref => ref.head === true)?.refname
}

/**
 * The ref a history list walks after a refs read settles: the reader's pick
 * while the repository still reports it, and the attached branch otherwise.
 * @param refs - the refs the repository reports.
 * @param ref - the ref the reader picked, `undefined` for all refs at `HEAD`.
 * @param picked - whether the reader picked the scope; false while the list follows the attached branch.
 * @returns the walked ref, `undefined` for all refs at `HEAD`.
 */
export function resolveHistoryRef(
  refs: readonly WorkspaceGitRef[],
  ref: string | undefined,
  picked: boolean,
): string | undefined {
  if (!picked) return attachedBranch(refs)
  // An explicit all-refs pick needs no ref name, and a picked ref the
  // repository still reports keeps the page it already walked.
  if (ref === undefined || refs.some(value => value.refname === ref)) return ref
  // The pick names a ref that is gone: return to the default scope rather than
  // to a history the pick never named.
  return attachedBranch(refs)
}

/**
 * Whether the walked scope starts at the repository's `HEAD`, so the working
 * tree's uncommitted changes sit above the list's newest commit. The all-refs
 * scope does, and so does the attached branch; another ref does not.
 * @param refs - the refs the repository reports.
 * @param ref - the walked ref, `undefined` for all refs.
 * @returns whether the uncommitted-changes row belongs above the list.
 */
export function walksHead(refs: readonly WorkspaceGitRef[], ref: string | undefined): boolean {
  return ref === undefined || ref === attachedBranch(refs)
}

/** How a quiet reread of the walked ref's first page relates to the loaded list. */
export type HistoryPageChange =
  /** The page repeats the loaded list, so nothing is written. */
  | { readonly kind: 'unchanged' }
  /** Commits newer than the list's first commit, in walk order, to put above it. */
  | { readonly kind: 'prepended'; readonly commits: readonly WorkspaceGitCommit[] }
  /** The walked ref no longer reaches the loaded rows, so the page replaces them. */
  | { readonly kind: 'replaced' }

/**
 * Decide what a quiet reread of the walked ref's first page means to the loaded
 * list. A commit landing at the tip only prepends the commits above the list's
 * first one, so the reader keeps the pages they loaded and the commit they are
 * reading; a rewritten ref, or a list the page no longer reaches, replaces it.
 * @param loaded - the commits the list holds, newest first.
 * @param page - the walked ref's first page, newest first.
 * @returns the change to apply to the loaded list.
 */
export function historyPageChange(
  loaded: readonly WorkspaceGitCommit[],
  page: readonly WorkspaceGitCommit[],
): HistoryPageChange {
  const first = loaded[0]
  if (first === undefined) return page.length === 0 ? { kind: 'unchanged' } : { kind: 'replaced' }
  const at = page.findIndex(commit => commit.hash === first.hash)
  if (at < 0) return { kind: 'replaced' }
  // From the list's first commit on, the page and the list must agree: a
  // mismatch means the walked ref was rewritten below the page's tip.
  for (let offset = 0; offset < page.length - at; offset += 1) {
    if (page[at + offset]?.hash !== loaded[offset]?.hash) return { kind: 'replaced' }
  }
  if (at === 0) return { kind: 'unchanged' }
  return { kind: 'prepended', commits: page.slice(0, at) }
}

/**
 * Group the refs by the commit each points at, so a history row can name the
 * refs sitting on its commit.
 * @param refs - the refs filter's list.
 * @returns tips by commit hash, each ordered for the inline pills.
 */
export function refsByCommit(refs: readonly WorkspaceGitRef[]): ReadonlyMap<string, readonly WorkspaceGitRef[]> {
  const grouped = new Map<string, WorkspaceGitRef[]>()
  for (const ref of refs) {
    const list = grouped.get(ref.hash)
    if (list === undefined) grouped.set(ref.hash, [ref])
    else list.push(ref)
  }
  for (const list of grouped.values()) list.sort(compareRefs)
  return grouped
}

/**
 * Take the pills one commit row or page draws.
 * @param refs - the commit's refs, already ordered.
 * @param max - how many names to draw.
 * @returns the drawn refs and the number left out.
 */
export function commitRefPills(refs: readonly WorkspaceGitRef[], max: number): CommitRefPills {
  return { shown: refs.slice(0, max), more: Math.max(0, refs.length - max) }
}

/**
 * Strip the Unicode bidi controls a ref name may carry before any view draws
 * it. git accepts them inside a ref name, so a repository the reader happens to
 * open can hold a tag that renders as a different name than the one it is —
 * `spoof<RLO>gnp.exe` reads as `spoof.exe` — and every surface here names a ref
 * verbatim: the row pills, the commit page's pills, the filter's rows, and the
 * chip that labels the walked scope. Control characters have no legitimate
 * place in a ref name's rendering, so removing them leaves every ordinary name
 * untouched.
 * @param name - the ref's name or full spelling.
 * @returns the name without bidi embedding, override, and isolate controls.
 */
export function refDisplayName(name: string): string {
  return name.replace(BIDI_CONTROLS, '')
}

/** The bidi embedding, override, and isolate controls. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu

/** File extensions the commit page prefers when it picks a file to compare first. */
const PREFERRED_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json)$/u

/** A `src` directory at the path's start or after a separator, so a top-level `src/` matches too. */
const SOURCE_DIRECTORY = /(?:^|\/)src\//u

/**
 * Choose the changed file the commit page shows first: a source file under a
 * `src` directory, then another code or data file, then the first one.
 * @param files - the commit's changed files in the Host's order.
 * @returns the file to select, or undefined when the commit changed none.
 */
export function pickHistoryFile(files: readonly WorkspaceGitCommitFile[]): WorkspaceGitCommitFile | undefined {
  return files.find(file => SOURCE_DIRECTORY.test(file.path))
    ?? files.find(file => PREFERRED_FILE.test(file.path))
    ?? files[0]
}

/**
 * The rename origin of one changed file in a loaded commit detail.
 * @param detail - the shown commit's detail, while it is loaded.
 * @param path - the changed file's path.
 * @returns the origin path, or undefined when the file is not a rename or the
 * detail is not loaded.
 */
export function renameOrigin(detail: WorkspaceGitCommitDetail | 'loading' | 'failed' | undefined, path: string): string | undefined {
  return typeof detail === 'object' ? detail.files.find(file => file.path === path)?.from : undefined
}

/**
 * Relative time as the history list and page state it.
 * @param iso - the commit's author date in ISO 8601.
 * @param now - current epoch ms, injected so the render stays a pure read.
 * @param t - the namespace translator.
 * @returns the localized relative label.
 */
export function historyTime(iso: string, now: number, t: TranslateNS<'sidebarFiles'>): string {
  const { unit, n } = relativeTime(Date.parse(iso), now)
  if (unit === 'now') return t('history.time.now')
  if (unit === 'days' && n === 1) return t('history.time.yesterday')
  return t(`history.time.${unit}`, { n })
}

/**
 * Absolute time for a commit's hover title.
 * @param iso - the commit's author date in ISO 8601.
 * @param t - the namespace translator.
 * @returns the localized date and time.
 */
export function absoluteTime(iso: string, t: TranslateNS<'sidebarFiles'>): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return t('history.time.absolute', {
    y: date.getFullYear(),
    m: pad(date.getMonth() + 1),
    d: pad(date.getDate()),
    hh: pad(date.getHours()),
    mm: pad(date.getMinutes()),
  })
}
