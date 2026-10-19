// @vitest-environment jsdom
/** The git view: route contract, the store's git slice, the panel, and the face's reads. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  WorkspaceFileDiff, WorkspaceGitEntry, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import { filesFace } from '../src/client/face.ts'
import { GitPanel } from '../src/client/GitPanel.tsx'
import { gitDiffUrl, gitStatusUrl, isFileDiff, isGitStatus, sameGitStatus } from '../src/git.ts'
import { en, zh } from '../src/client/locales.ts'
import { createFilesStore } from '../src/client/store.ts'
import type { GitTabState } from '../src/client/store.ts'
import { mountBody, ROOT, SESSION, TAB } from './mount.client.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh)
const MODIFIED: WorkspaceGitEntry = { path: 'src/a.ts', display: 'src/a.ts', kind: 'modified' }
const ADDED: WorkspaceGitEntry = { path: 'src/b.ts', display: 'src/b.ts', kind: 'added' }
const UNTRACKED: WorkspaceGitEntry = { path: 'new.ts', display: 'new.ts', kind: 'untracked' }
const REPOSITORY: WorkspaceGitStatus = {
  kind: 'repository',
  branch: 'main',
  total: 3,
  entries: [MODIFIED, ADDED, UNTRACKED],
}
const DIFF: WorkspaceFileDiff = {
  kind: 'text',
  path: 'src/a.ts',
  display: 'src/a.ts',
  before: true,
  after: true,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
  coarse: false,
}

/** A tab's git slice with every field defaulted. */
function gitState(overrides: Partial<GitTabState> = {}): GitTabState {
  return {
    status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
    scrollTop: 0, diff: undefined, diffMode: 'unified', ratio: 0.58, groups: { changed: true, untracked: true },
    ...overrides,
  }
}

/** Render the panel with recording gestures. */
function panel(overrides: Partial<GitTabState> = {}, hands: {
  readonly onSelect?: (entry: WorkspaceGitEntry) => void
  readonly onReload?: () => void
  readonly onRetryDiff?: () => void
  readonly onMode?: (mode: 'unified' | 'split') => void
  readonly onRatio?: (ratio: number) => void
  readonly onScrolled?: (scrollTop: number) => void
  readonly onToggleGroup?: (group: 'changed' | 'untracked') => void
} = {}) {
  const git = gitState(overrides)
  return render(
    <GitPanel
      git={git}
      onSelect={hands.onSelect ?? vi.fn()}
      onReload={hands.onReload ?? vi.fn()}
      onRetryDiff={hands.onRetryDiff ?? vi.fn()}
      onMode={hands.onMode ?? vi.fn()}
      onRatio={hands.onRatio ?? vi.fn()}
      onScrolled={hands.onScrolled ?? vi.fn()}
      onToggleGroup={hands.onToggleGroup ?? vi.fn()}
      ratio={git.ratio}
      t={t}
    />,
  )
}

describe('git route contract', () => {
  it('builds authenticated coordinates, including a rename origin, and validates both answers', () => {
    expect(gitStatusUrl('s1', '/work/app')).toBe('api/git.status?sessionId=s1&cwd=%2Fwork%2Fapp')
    expect(gitDiffUrl('s1', '/work/app', { path: 'src/a.ts' }))
      .toBe('api/git.diff?sessionId=s1&cwd=%2Fwork%2Fapp&path=src%2Fa.ts')
    expect(gitDiffUrl('s1', '/work/app', { path: 'src/new.ts', from: 'src/old.ts' }))
      .toBe('api/git.diff?sessionId=s1&cwd=%2Fwork%2Fapp&path=src%2Fnew.ts&from=src%2Fold.ts')
    expect(isGitStatus(REPOSITORY)).toBe(true)
    expect(isGitStatus({ kind: 'not-a-repository', entries: [], total: 0 })).toBe(true)
    expect(isGitStatus({ kind: 'unavailable', entries: [], total: 0 })).toBe(true)
    // A non-repository answer carries no entries and no count.
    expect(isGitStatus({ kind: 'not-a-repository', entries: [] })).toBe(false)
    expect(isGitStatus({ kind: 'not-a-repository', entries: [], total: 1 })).toBe(false)
    expect(isGitStatus({ kind: 'not-a-repository', entries: [MODIFIED], total: 0 })).toBe(false)
    // The entry cap never exceeds the complete count.
    expect(isGitStatus({ kind: 'repository', entries: [MODIFIED], total: 2 })).toBe(true)
    expect(isGitStatus({ kind: 'repository', entries: [MODIFIED], total: 0 })).toBe(false)
    expect(isGitStatus({ kind: 'repository', entries: [], total: -1 })).toBe(false)
    expect(isGitStatus({ kind: 'repository', entries: [], total: 1.5 })).toBe(false)
    expect(isGitStatus({ kind: 'repository', entries: [], total: 0 })).toBe(true)
    expect(isGitStatus({ kind: 'repository', branch: 7, entries: [], total: 0 })).toBe(false)
    expect(isGitStatus({ kind: 'repository', entries: [{ path: '/abs', display: 'abs', kind: 'modified' }], total: 1 }))
      .toBe(false)
    expect(isGitStatus({ kind: 'repository', entries: [{ path: 'a', display: 'a', kind: 'moved' }], total: 1 }))
      .toBe(false)
    // A rename origin must be a working-directory-relative path too.
    expect(isGitStatus({
      kind: 'repository', total: 1,
      entries: [{ path: 'a', display: 'a', kind: 'renamed', from: 'b' }],
    })).toBe(true)
    expect(isGitStatus({
      kind: 'repository', total: 1,
      entries: [{ path: 'a', display: 'a', kind: 'renamed', from: '/abs' }],
    })).toBe(false)
    expect(isGitStatus({
      kind: 'repository', total: 1,
      entries: [{ path: 'a', display: 'a', kind: 'renamed', from: '' }],
    })).toBe(false)
    expect(isGitStatus(null)).toBe(false)
    expect(sameGitStatus(REPOSITORY, REPOSITORY)).toBe(true)
    expect(sameGitStatus(undefined, REPOSITORY)).toBe(false)
    expect(sameGitStatus(REPOSITORY, { ...REPOSITORY, branch: 'dev' })).toBe(false)
    const emptyTree: WorkspaceGitStatus = { kind: 'repository', branch: 'main', entries: [], total: 0 }
    expect(sameGitStatus(REPOSITORY, emptyTree)).toBe(false)
    // A rename's original path is part of what the row draws.
    expect(sameGitStatus(REPOSITORY, { ...REPOSITORY, entries: [REPOSITORY.entries[0]!, { ...REPOSITORY.entries[1]!, from: 'src/old.ts' }, REPOSITORY.entries[2]!] }))
      .toBe(false)
    expect(isFileDiff(DIFF)).toBe(true)
    expect(isFileDiff({ kind: 'binary', path: 'a', display: 'a' })).toBe(true)
    expect(isFileDiff({ kind: 'oversized', path: 'a', display: 'a' })).toBe(true)
    expect(isFileDiff({ ...DIFF, hunks: [{ oldStart: 1 }] })).toBe(false)
    expect(isFileDiff({ ...DIFF, hunks: [null] })).toBe(false)
    expect(isFileDiff({ ...DIFF, hunks: [{ ...DIFF.hunks[0]!, oldStart: '1' }] })).toBe(false)
    // A hunk line count must be a non-negative integer and every line carries its marker.
    expect(isFileDiff({ ...DIFF, hunks: [{ ...DIFF.hunks[0]!, oldStart: -1 }] })).toBe(false)
    expect(isFileDiff({ ...DIFF, hunks: [{ ...DIFF.hunks[0]!, newLines: 1.5 }] })).toBe(false)
    expect(isFileDiff({ ...DIFF, hunks: [{ ...DIFF.hunks[0]!, lines: ['old'] }] })).toBe(false)
    expect(isFileDiff({ ...DIFF, hunks: [{ ...DIFF.hunks[0]!, lines: [7] }] })).toBe(false)
    expect(isFileDiff('nope')).toBe(false)
  })
})

describe('git slice', () => {
  it('records a status read, dropping a selection the new status no longer lists', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    store.actions.gitLoading(TAB)
    expect(store.getSnapshot().byTab[TAB]?.git.loading).toBe(true)
    store.actions.gitStatusLoaded(TAB, REPOSITORY)
    expect(store.getSnapshot().byTab[TAB]?.git).toMatchObject({ loading: false, failure: false, status: REPOSITORY })
    // Select a path, then answer with a status that no longer has it.
    store.actions.gitEntrySelected(TAB, 'src/a.ts', undefined)
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
    store.actions.gitStatusLoaded(TAB, { kind: 'repository', entries: [], total: 0 })
    expect(store.getSnapshot().byTab[TAB]?.git.selected).toBeUndefined()
    expect(store.getSnapshot().byTab[TAB]?.git.selectedFrom).toBeUndefined()
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBeUndefined()
    // A failed read keeps what the panel had and records the failure.
    store.actions.gitLoading(TAB)
    store.actions.gitStatusFailed(TAB)
    expect(store.getSnapshot().byTab[TAB]?.git.loading).toBe(false)
    expect(store.getSnapshot().byTab[TAB]?.git.failure).toBe(true)
    store.actions.gitStatusLoaded(TAB, REPOSITORY)
    expect(store.getSnapshot().byTab[TAB]?.git.failure).toBe(false)
  })

  it('keeps a selection listed by a new status and syncs its rename origin', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    store.actions.gitStatusLoaded(TAB, REPOSITORY)
    store.actions.gitEntrySelected(TAB, 'src/a.ts', undefined)
    store.actions.gitStatusLoaded(TAB, REPOSITORY)
    expect(store.getSnapshot().byTab[TAB]?.git.selected).toBe('src/a.ts')
    const renamed: WorkspaceGitStatus = {
      kind: 'repository', total: 1, entries: [{ path: 'src/a.ts', display: 'src/a.ts', kind: 'renamed', from: 'src/z.ts' }],
    }
    store.actions.gitStatusLoaded(TAB, renamed)
    expect(store.getSnapshot().byTab[TAB]?.git.selectedFrom).toBe('src/z.ts')
  })

  it('returns to the files container when the directory stops being a repository', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    store.actions.containerSelected(TAB, 'git')
    // An unavailable read is retryable and keeps the git container.
    store.actions.gitStatusLoaded(TAB, { kind: 'unavailable', entries: [], total: 0 })
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('git')
    store.actions.gitStatusLoaded(TAB, { kind: 'not-a-repository', entries: [], total: 0 })
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('files')
  })

  it('keeps a comparison only for the path the panel shows', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    store.actions.gitStatusLoaded(TAB, REPOSITORY)
    store.actions.gitEntrySelected(TAB, 'src/a.ts', undefined)
    // A selection the store already shows as loading asks only once.
    store.actions.gitEntrySelected(TAB, 'src/a.ts', undefined)
    store.actions.gitDiffLoaded(TAB, 'src/b.ts', DIFF)
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
    store.actions.gitDiffLoaded(TAB, 'src/a.ts', DIFF)
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toEqual(DIFF)
    // The same path with a new rename origin is a new comparison.
    store.actions.gitEntrySelected(TAB, 'src/a.ts', 'src/z.ts')
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
    store.actions.gitDiffLoaded(TAB, 'src/a.ts', DIFF)
    store.actions.gitEntrySelected(TAB, 'src/b.ts', undefined)
    store.actions.gitDiffFailed(TAB, 'src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
    store.actions.gitDiffFailed(TAB, 'src/b.ts')
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('failed')
    // A reload marks the shown comparison as being read again, and does nothing
    // while no path is shown.
    store.actions.gitDiffReloading(TAB)
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
    store.actions.gitEntrySelected(TAB, 'src/a.ts', undefined)
    store.actions.gitDiffLoaded(TAB, 'src/a.ts', DIFF)
    store.actions.gitStatusLoaded(TAB, { kind: 'repository', entries: [], total: 0 })
    store.actions.gitDiffReloading(TAB)
    expect(store.getSnapshot().byTab[TAB]?.git.diff).toBeUndefined()
    // The layout choice and the list offset are kept per tab.
    store.actions.gitDiffModeSelected(TAB, 'split')
    expect(store.getSnapshot().byTab[TAB]?.git.diffMode).toBe('split')
    store.actions.gitListScrolled(TAB, 96)
    expect(store.getSnapshot().byTab[TAB]?.git.scrollTop).toBe(96)
    // Both groups start expanded and fold one at a time.
    store.actions.gitGroupToggled(TAB, 'changed')
    expect(store.getSnapshot().byTab[TAB]?.git.groups).toEqual({ changed: false, untracked: true })
    store.actions.gitGroupToggled(TAB, 'untracked')
    expect(store.getSnapshot().byTab[TAB]?.git.groups).toEqual({ changed: false, untracked: false })
  })
})

describe('GitPanel', () => {
  it('groups tracked and untracked paths and reports the picked entry', () => {
    const onSelect = vi.fn()
    const { container } = panel({ status: REPOSITORY }, { onSelect })
    expect(container.querySelector('[data-files-git-title]')?.textContent).toBe(zh['git.title'])
    expect(container.querySelector('[data-files-git-branch]')?.textContent).toBe('main')
    const groups = [...container.querySelectorAll('[data-files-git-group]')].map(group => group.getAttribute('data-files-git-group'))
    expect(groups).toEqual(['changed', 'untracked'])
    // The comparison leads and the changed-path list trails, with the workbench's
    // draggable splitter between them.
    expect(container.querySelector('[data-files-splitter]')).not.toBeNull()
    const compare = container.querySelector('[data-files-git-compare]')!
    const list = container.querySelector('[data-files-git-list]')!
    expect(compare.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The list's top bar lives outside the scroller, so a long list scrolls
    // under it instead of carrying title, branch, and reload out of view.
    const gitHeader = container.querySelector('[data-files-git-header]')!
    expect(list.contains(gitHeader)).toBe(false)
    expect(gitHeader.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Each row states its change kind, which colors its letter.
    expect([...container.querySelectorAll('[data-files-git-entry]')].map(row => row.getAttribute('data-files-git-kind')))
      .toEqual(['modified', 'added', 'untracked'])
    // The row names the file and its containing directory separately.
    const row = container.querySelector('[data-files-git-entry="src/a.ts"]')!
    expect(row.textContent).toBe('M' + 'a.ts' + 'src')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(MODIFIED)
  })

  it('draws a single group when only one kind is present, and marks the shown path', () => {
    const onlyUntracked = panel({ status: { kind: 'repository', entries: [UNTRACKED], total: 1 }, selected: 'new.ts' })
    expect(onlyUntracked.container.querySelectorAll('[data-files-git-group]')).toHaveLength(1)
    const row = onlyUntracked.container.querySelector('[data-files-git-entry="new.ts"]')!
    expect(row.getAttribute('aria-current')).toBe('true')
    cleanup()
    const onlyChanged = panel({ status: { kind: 'repository', entries: [MODIFIED], total: 1 } })
    const groups = [...onlyChanged.container.querySelectorAll('[data-files-git-group]')].map(group => group.getAttribute('data-files-git-group'))
    expect(groups).toEqual(['changed'])
    expect(onlyChanged.container.querySelector('[data-files-git-entry="src/a.ts"]')?.getAttribute('aria-current')).toBeNull()
  })

  it('folds and reopens a group, both starting expanded', () => {
    const onToggleGroup = vi.fn()
    const { container, rerender } = render(
      <GitPanel git={gitState({ status: REPOSITORY })} onSelect={vi.fn()} onReload={vi.fn()} onRetryDiff={vi.fn()}
        onMode={vi.fn()} onRatio={vi.fn()} onScrolled={vi.fn()} onToggleGroup={onToggleGroup} ratio={0.58} t={t} />,
    )
    const header = container.querySelector<HTMLButtonElement>('[data-files-git-group-toggle="changed"]')!
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-files-git-entry]')).toHaveLength(3)
    fireEvent.click(header)
    expect(onToggleGroup).toHaveBeenCalledWith('changed')
    fireEvent.click(container.querySelector('[data-files-git-group-toggle="untracked"]')!)
    expect(onToggleGroup).toHaveBeenLastCalledWith('untracked')
    // A folded group keeps its header and count and hides its rows.
    rerender(
      <GitPanel git={gitState({ status: REPOSITORY, groups: { changed: false, untracked: true } })} onSelect={vi.fn()}
        onReload={vi.fn()} onRetryDiff={vi.fn()} onMode={vi.fn()} onRatio={vi.fn()} onScrolled={vi.fn()}
        onToggleGroup={onToggleGroup} ratio={0.58} t={t} />,
    )
    expect(container.querySelector('[data-files-git-group-toggle="changed"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-files-git-entry]')).toHaveLength(1)
    rerender(
      <GitPanel git={gitState({ status: REPOSITORY, groups: { changed: true, untracked: false } })} onSelect={vi.fn()}
        onReload={vi.fn()} onRetryDiff={vi.fn()} onMode={vi.fn()} onRatio={vi.fn()} onScrolled={vi.fn()}
        onToggleGroup={onToggleGroup} ratio={0.58} t={t} />,
    )
    expect(container.querySelectorAll('[data-files-git-entry]')).toHaveLength(2)
  })

  it('reads the working tree again from its header control', () => {
    const onReload = vi.fn()
    const { container } = panel({ status: REPOSITORY }, { onReload })
    fireEvent.click(container.querySelector('[data-files-git-refresh]')!)
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('picks an untracked path and switches the comparison layout', () => {
    const onSelect = vi.fn()
    const onMode = vi.fn()
    const { container } = panel({ status: REPOSITORY, selected: 'src/a.ts', diff: DIFF }, { onSelect, onMode })
    fireEvent.click(container.querySelector('[data-files-git-entry="new.ts"]')!)
    expect(onSelect).toHaveBeenCalledWith(UNTRACKED)
    // The unified column is drawn by the shared numbered renderer.
    expect(container.querySelector('[data-review-view="unified"]')).not.toBeNull()
    const split = container.querySelector<HTMLButtonElement>('[data-files-git-diff-mode="split"]')!
    expect(split.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(split)
    expect(onMode).toHaveBeenCalledWith('split')
    cleanup()
    // The split layout pairs the two sides and marks its own rows.
    const drawn = panel({ status: REPOSITORY, selected: 'src/a.ts', diff: DIFF, diffMode: 'split' })
    expect(drawn.container.querySelector('[data-review-view="split"]')).not.toBeNull()
    expect(drawn.container.querySelector('[data-files-git-diff-mode="split"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(drawn.container.querySelectorAll('[data-diff-line]').length).toBeGreaterThan(0)
    cleanup()
    // A coarse comparison states it above the hunks, and a created file notes it.
    const coarse = panel({
      status: REPOSITORY,
      selected: 'src/a.ts',
      diff: { ...DIFF, coarse: true, before: false, hunks: [{ ...DIFF.hunks[0]!, lines: ['+only'] }] },
    })
    expect(coarse.container.querySelector('[data-diff-coarse]')?.textContent).toBe(zh['diff.coarse'])
    expect(coarse.container.querySelector('[data-diff-note="metadata"]')?.textContent).toBe(zh['git.diff.created'])
  })

  it('draws the loading, failed, clean, and non-repository states', () => {
    expect(panel({ loading: true }).container.querySelector('[data-files-git-state="loading"]')).not.toBeNull()
    cleanup()
    expect(panel({}).container.querySelector('[data-files-git-state="failed"]')).not.toBeNull()
    cleanup()
    // A Host answer of unavailable is the same failed state.
    expect(panel({ status: { kind: 'unavailable', entries: [], total: 0 } })
      .container.querySelector('[data-files-git-state="failed"]')).not.toBeNull()
    cleanup()
    expect(panel({ status: { kind: 'repository', entries: [], total: 0 } })
      .container.querySelector('[data-files-git-state="clean"]')).not.toBeNull()
    cleanup()
    // A non-repository answer draws no list at all.
    expect(panel({ status: { kind: 'not-a-repository', entries: [], total: 0 } })
      .container.querySelector('[data-files-git-state]')).toBeNull()
  })

  it('keeps the last list on screen when a reload fails, and offers the retry', () => {
    const onReload = vi.fn()
    const { container } = panel({ status: REPOSITORY, failure: true }, { onReload })
    expect(container.querySelector('[data-files-git-state="failed"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-files-git-entry]')).toHaveLength(3)
    fireEvent.click(container.querySelector('[data-files-git-retry]')!)
    expect(onReload).toHaveBeenCalledOnce()
    cleanup()
    // The never-answered state offers the same retry.
    const refused = panel({}, { onReload })
    fireEvent.click(refused.container.querySelector('[data-files-git-retry]')!)
    expect(onReload).toHaveBeenCalledTimes(2)
    cleanup()
    // An empty list after a failed reload states the failure once, not cleanliness.
    const empty = panel({ status: { kind: 'repository', entries: [], total: 0 }, failure: true })
    expect(empty.container.querySelector('[data-files-git-state="clean"]')).toBeNull()
    expect(empty.container.querySelector('[data-files-git-state="failed"]')).not.toBeNull()
  })

  it('states how many changes the entry cap omitted', () => {
    const { container } = panel({ status: { kind: 'repository', entries: [MODIFIED], total: 5 } })
    expect(container.querySelector('[data-files-git-truncated]')?.textContent)
      .toBe(zh['git.truncated'].replace('{shown}', '1').replace('{total}', '5'))
  })

  it('draws the comparison in each of its states', () => {
    const states = (overrides: Partial<GitTabState>): string | null =>
      panel(overrides).container.querySelector('[data-files-git-diff-state]')?.getAttribute('data-files-git-diff-state') ?? null
    expect(states({ status: REPOSITORY })).toBe('none')
    cleanup()
    // A clean repository states it once, in the list.
    expect(states({ status: { kind: 'repository', entries: [], total: 0 } })).toBeNull()
    cleanup()
    expect(states({ status: REPOSITORY, selected: 'src/a.ts', diff: 'loading' })).toBe('loading')
    cleanup()
    expect(states({ status: REPOSITORY, selected: 'src/a.ts', diff: 'failed' })).toBe('failed')
    cleanup()
    expect(states({ status: REPOSITORY, selected: 'src/a.ts', diff: { kind: 'binary', path: 'a', display: 'a' } })).toBe('binary')
    cleanup()
    expect(states({ status: REPOSITORY, selected: 'src/a.ts', diff: { kind: 'oversized', path: 'a', display: 'a' } })).toBe('oversized')
    cleanup()
    expect(states({ status: REPOSITORY, selected: 'src/a.ts', diff: { ...DIFF, hunks: [] } })).toBe('empty')
    cleanup()
    const drawn = panel({ status: REPOSITORY, selected: 'src/a.ts', diff: DIFF })
    expect(drawn.container.querySelector('[data-files-git-diff="src/a.ts"]')).not.toBeNull()
    expect(drawn.container.querySelector('[data-files-git-diff]')?.textContent).toContain('new')
  })

  it('asks for the shown comparison again from its failed state', () => {
    const onRetryDiff = vi.fn()
    const { container } = panel({ status: REPOSITORY, selected: 'src/a.ts', diff: 'failed' }, { onRetryDiff })
    fireEvent.click(container.querySelector('[data-files-git-diff-retry]')!)
    expect(onRetryDiff).toHaveBeenCalledOnce()
  })

  it('restores the changed-path list offset on mount and reports it on unmount', () => {
    const onScrolled = vi.fn()
    const { container, unmount } = panel({ status: REPOSITORY, scrollTop: 120 }, { onScrolled })
    const list = container.querySelector<HTMLElement>('[data-files-git-list]')!
    expect(list.scrollTop).toBe(120)
    list.scrollTop = 240
    fireEvent.scroll(list)
    unmount()
    expect(onScrolled).toHaveBeenCalledWith(240)
  })
})

describe('face git reads', () => {
  const faceOf = () => {
    const instance = createFilesStore().create()
    return filesFace(vi.fn() as never, vi.fn() as never)(SESSION, instance.actions)
  }

  it('returns the Host answers it validates with their read generation', async () => {
    const face = faceOf()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(REPOSITORY)))
    await expect(face.gitStatus(TAB, ROOT, new AbortController().signal))
      .resolves.toEqual({ value: REPOSITORY, current: true })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(DIFF)))
    await expect(face.gitDiff(TAB, ROOT, { path: 'src/a.ts' }, new AbortController().signal))
      .resolves.toEqual({ value: DIFF, current: true })
  })

  it('answers no value for a refused, malformed, or failed read', async () => {
    const face = faceOf()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(face.gitStatus(TAB, ROOT, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    await expect(face.gitDiff(TAB, ROOT, { path: 'a' }, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'weird' })))
    await expect(face.gitStatus(TAB, ROOT, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    await expect(face.gitDiff(TAB, ROOT, { path: 'a' }, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    // An answer for another path is not the selection's comparison.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...DIFF, path: 'other.ts' })))
    await expect(face.gitDiff(TAB, ROOT, { path: 'a' }, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(face.gitStatus(TAB, ROOT, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
    await expect(face.gitDiff(TAB, ROOT, { path: 'a' }, new AbortController().signal))
      .resolves.toEqual({ value: undefined, current: true })
  })

  it('marks an answer that a newer read of the same kind superseded', async () => {
    const face = faceOf()
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve) })))
    const first = face.gitStatus(TAB, ROOT, new AbortController().signal)
    const second = face.gitStatus(TAB, ROOT, new AbortController().signal)
    pending[1]!(Response.json(REPOSITORY))
    await expect(second).resolves.toEqual({ value: REPOSITORY, current: true })
    pending[0]!(Response.json(REPOSITORY))
    await expect(first).resolves.toEqual({ value: REPOSITORY, current: false })
  })
})

describe('git view through the body', () => {
  it('offers the git container for a repository and after a failed read', async () => {
    const failed = mountBody()
    await act(() => failed.script.watches.ready(ROOT))
    await act(() => failed.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(failed.gitStatus).toHaveBeenCalledOnce()
    expect(failed.instance.getSnapshot().byTab[TAB]?.git.failure).toBe(true)
    // The retry stays reachable: the failed read keeps the container on the rail.
    expect(failed.view.container.querySelector('[data-files-rail-item="git"]')).not.toBeNull()
    cleanup()
    const second = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => second.script.watches.ready(ROOT))
    await act(() => second.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(second.view.container.querySelector('[data-files-rail-item="git"]')).not.toBeNull()
    // Selecting it draws the panel instead of the two columns.
    fireEvent.click(second.view.container.querySelector('[data-files-rail-item="git"]')!)
    expect(second.view.container.querySelector('[data-files-git-panel]')).not.toBeNull()
    // The files view's own seats — its chips and its tree — are gone.
    expect(second.view.container.querySelector('[data-files-tabs]')).toBeNull()
    expect(second.view.container.querySelector('[data-files-body]')).toBeNull()
  })

  it('retries a refused status and a refused comparison from the panel', async () => {
    const refused = mountBody()
    await act(() => refused.script.watches.ready(ROOT))
    await act(() => refused.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(refused.instance.getSnapshot().byTab[TAB]?.git.loading).toBe(false)
    expect(refused.instance.getSnapshot().byTab[TAB]?.git.status).toBeUndefined()
    fireEvent.click(refused.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(refused.view.container.querySelector('[data-files-git-retry]')!)
    })
    expect(refused.gitStatus).toHaveBeenCalledTimes(2)
    cleanup()
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).toBe('failed')
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-diff-retry]')!)
    })
    expect(mounted.gitDiff).toHaveBeenCalledTimes(2)
  })

  it('settles the git columns on a drag and keeps the chosen share', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    fireEvent.click(mounted.view.container.querySelector('[data-files-git-group-toggle="changed"]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.groups.changed).toBe(false)
    const split = mounted.view.container.querySelector('[data-files-splitter]')!
    Object.defineProperty(split.parentElement!, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    split.setPointerCapture = () => {}
    split.releasePointerCapture = () => {}
    split.hasPointerCapture = () => true
    act(() => { fireEvent.pointerDown(split, { pointerId: 1, button: 0, clientX: 400 }) })
    act(() => { fireEvent.pointerMove(split, { pointerId: 1, clientX: 750 }) })
    act(() => { fireEvent.pointerUp(split, { pointerId: 1, clientX: 750 }) })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.ratio).toBeCloseTo(0.75, 5)
    // The range clamps at 80% of the view.
    act(() => { fireEvent.pointerDown(split, { pointerId: 2, button: 0, clientX: 900 }) })
    act(() => { fireEvent.pointerUp(split, { pointerId: 2, clientX: 990 }) })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.ratio).toBe(0.8)
  })

  it('refreshes the tree quietly while the git view is open', async () => {
    vi.useFakeTimers()
    try {
      const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
      await act(() => mounted.script.watches.ready(ROOT))
      await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
      fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
      await act(async () => { fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!) })
      const before = mounted.gitStatus.mock.calls.length
      // An unchanged tree: the quiet read runs, writes nothing, and shows no
      // loading state (the list never blanks out).
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(mounted.gitStatus.mock.calls.length).toBe(before + 1)
      expect(mounted.view.container.querySelector('[data-files-git-state="loading"]')).toBeNull()
      // A changed tree updates in place, and the shown comparison is re-read.
      const changed = { ...REPOSITORY, entries: [...REPOSITORY.entries, { path: 'src/c.ts', display: 'src/c.ts', kind: 'modified' as const }] }
      mounted.gitStatus.mockResolvedValueOnce({ value: changed, current: true })
      const diffs = mounted.gitDiff.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(mounted.instance.getSnapshot().byTab[TAB]?.git.status).toEqual(changed)
      expect(mounted.view.container.querySelectorAll('[data-files-git-entry]')).toHaveLength(4)
      expect(mounted.gitDiff.mock.calls.length).toBeGreaterThan(diffs)
      // Leaving the container stops the timer.
      fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="files"]')!)
      const after = mounted.gitStatus.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect(mounted.gitStatus.mock.calls.length).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops refreshing while the panel is off screen and refreshes when it returns', async () => {
    vi.useFakeTimers()
    try {
      // The Sidebar is collapsed: the tab body stays mounted, but the view must
      // not keep reading a working tree nobody is looking at.
      const hidden = mountBody(ROOT, undefined, { status: REPOSITORY }, { expanded: false })
      await act(() => hidden.script.watches.ready(ROOT))
      await act(() => hidden.script.settle({ ok: true, value: { entries: [], truncated: false } }))
      fireEvent.click(hidden.view.container.querySelector('[data-files-rail-item="git"]')!)
      const idle = hidden.gitStatus.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect(hidden.gitStatus.mock.calls.length).toBe(idle)
      cleanup()
      // A visible panel polls, and a tab that is hidden by its pane behaves the same.
      const visible = mountBody(ROOT, undefined, { status: REPOSITORY }, { expanded: true, visible: false })
      await act(() => visible.script.watches.ready(ROOT))
      await act(() => visible.script.settle({ ok: true, value: { entries: [], truncated: false } }))
      fireEvent.click(visible.view.container.querySelector('[data-files-rail-item="git"]')!)
      const before = visible.gitStatus.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(visible.gitStatus.mock.calls.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a read that settles after the tab record ended', async () => {
    const aborted = mountBody(ROOT, undefined, { status: REPOSITORY })
    aborted.controller.abort()
    await act(async () => {})
    // The record's abort forgets the bucket; the settled read must not write to it.
    expect(aborted.instance.getSnapshot().byTab[TAB]).toBeUndefined()
    cleanup()
    const picked = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => picked.script.watches.ready(ROOT))
    await act(() => picked.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(picked.view.container.querySelector('[data-files-rail-item="git"]')!)
    fireEvent.click(picked.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    picked.controller.abort()
    await act(async () => {})
    expect(picked.instance.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('asks for a comparison when a changed path is picked', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(mounted.gitDiff).toHaveBeenCalledWith(TAB, ROOT, { path: 'src/a.ts' }, expect.anything())
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).toEqual(DIFF)
    // The layout control writes the store and the drawn comparison follows it.
    expect(mounted.view.container.querySelector('[data-review-view="unified"]')).not.toBeNull()
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-diff-mode="split"]')!)
    })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diffMode).toBe('split')
    expect(mounted.view.container.querySelector('[data-review-view="split"]')).not.toBeNull()
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-diff-mode="unified"]')!)
    })
    expect(mounted.view.container.querySelector('[data-review-view="unified"]')).not.toBeNull()
    // A one-sided comparison (an added file) still honours the choice: the side
    // with no lines is drawn empty rather than forcing one column.
    const added = mountBody(ROOT, undefined, {
      status: REPOSITORY,
      diff: { ...DIFF, before: false, hunks: [{ ...DIFF.hunks[0]!, lines: ['+only'] }] },
    })
    await act(() => added.script.watches.ready(ROOT))
    await act(() => added.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(added.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(added.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(added.view.container.querySelector('[data-review-view="unified"]')).not.toBeNull()
    await act(async () => {
      fireEvent.click(added.view.container.querySelector('[data-files-git-diff-mode="split"]')!)
    })
    expect(added.view.container.querySelector('[data-review-view="split"]')).not.toBeNull()
  })

  it('echoes a rename origin in the comparison request', async () => {
    const renamed: WorkspaceGitStatus = {
      kind: 'repository',
      branch: 'main',
      total: 1,
      entries: [{ path: 'src/new.ts', display: 'src/new.ts', kind: 'renamed', from: 'src/old.ts' }],
    }
    const mounted = mountBody(ROOT, undefined, { status: renamed, diff: { ...DIFF, path: 'src/new.ts', display: 'src/new.ts' } })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/new.ts"]')!)
    })
    expect(mounted.gitDiff).toHaveBeenCalledWith(
      TAB, ROOT, { path: 'src/new.ts', from: 'src/old.ts' }, expect.anything(),
    )
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.selectedFrom).toBe('src/old.ts')
  })

  it('reloads the shown comparison with the working tree', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(mounted.gitStatus).toHaveBeenCalledTimes(1)
    expect(mounted.gitDiff).toHaveBeenCalledTimes(1)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-refresh]')!)
    })
    expect(mounted.gitStatus).toHaveBeenCalledTimes(2)
    expect(mounted.gitDiff).toHaveBeenCalledTimes(2)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).toEqual(DIFF)
  })

  it('does not strand a selection made while a reload is in flight', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(mounted.gitDiff).toHaveBeenCalledTimes(1)
    // Hold the status answer while the reader picks another path.
    let release!: (answer: { value: WorkspaceGitStatus; current: boolean }) => void
    mounted.gitStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-refresh]')!)
    })
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/b.ts"]')!)
    })
    expect(mounted.gitDiff).toHaveBeenCalledTimes(2)
    await act(async () => { release({ value: REPOSITORY, current: true }) })
    // The status settled after the reader moved: the newer selection's fresh
    // comparison stands instead of being replaced and left loading.
    expect(mounted.gitDiff).toHaveBeenCalledTimes(2)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.selected).toBe('src/b.ts')
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).not.toBe('loading')
  })

  it('aborts a comparison whose path the status no longer lists', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    // A comparison that never settles stays in flight.
    mounted.gitDiff.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    const read = mounted.gitDiff.mock.calls[0]![3]
    let release!: (answer: { value: WorkspaceGitStatus; current: boolean }) => void
    mounted.gitStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-refresh]')!)
    })
    await act(async () => { release({ value: { kind: 'repository', entries: [], total: 0 }, current: true }) })
    expect(read.aborted).toBe(true)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.selected).toBeUndefined()
  })

  it('keeps the git view and its retry reachable when git is unavailable', async () => {
    const mounted = mountBody(ROOT, undefined, { status: { kind: 'unavailable', entries: [], total: 0 } })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(mounted.view.container.querySelector('[data-files-rail-item="git"]')).not.toBeNull()
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    expect(mounted.view.container.querySelector('[data-files-git-state="failed"]')).not.toBeNull()
    expect(mounted.view.container.querySelector('[data-files-git-retry]')).not.toBeNull()
  })

  it('drops a status or comparison answer a newer read superseded', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    // A refresh whose answer a newer read superseded leaves the shown status alone.
    mounted.gitStatus.mockResolvedValueOnce({ value: { kind: 'repository', entries: [], total: 0 }, current: false })
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-refresh]')!)
    })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.status).toEqual(REPOSITORY)
    // A comparison answer a newer read superseded never leaves its loading state.
    mounted.gitDiff.mockResolvedValueOnce({ value: DIFF, current: false })
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).toBe('loading')
  })

  it('keeps the newer comparison readable when an older one settles late', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY, diff: DIFF })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    let releaseFirst!: (answer: { value: WorkspaceFileDiff; current: boolean }) => void
    mounted.gitDiff.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/a.ts"]')!)
    })
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-git-entry="src/b.ts"]')!)
    })
    // The superseded read settles after the newer one; its answer is dropped and
    // the newer comparison stays.
    await act(async () => { releaseFirst({ value: DIFF, current: true }) })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.selected).toBe('src/b.ts')
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.diff).toEqual(DIFF)
  })

  it('keeps the changed-path list offset across a container switch', async () => {
    const mounted = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    const list = mounted.view.container.querySelector<HTMLElement>('[data-files-git-list]')!
    list.scrollTop = 140
    fireEvent.scroll(list)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="files"]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.git.scrollTop).toBe(140)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
    expect(mounted.view.container.querySelector<HTMLElement>('[data-files-git-list]')?.scrollTop).toBe(140)
  })
})

describe('git copy', () => {
  it('names the same keys in both dictionaries', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
