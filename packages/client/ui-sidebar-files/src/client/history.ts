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
  WorkspaceGitCommitDetail, WorkspaceGitCommitFile, WorkspaceGitRef,
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
