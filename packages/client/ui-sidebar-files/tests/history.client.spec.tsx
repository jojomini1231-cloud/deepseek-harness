// @vitest-environment jsdom
/** The history view's data layer: pure helpers, the store slice, and the face's reads. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceGitCommit, WorkspaceGitHistory, WorkspaceGitRef } from '@deepseek-ai/dsh-workspace-changes/types'
import { filesFace } from '../src/client/face.ts'
import {
  absoluteTime, commitRefPills, historyTime, pickHistoryFile, refDisplayName, refsByCommit, renameOrigin,
} from '../src/client/history.ts'
import { isGitCommitDetail, isGitHistory, isGitRefs } from '../src/git.ts'
import { zh } from '../src/client/locales.ts'
import { createFilesStore } from '../src/client/store.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SESSION } from './mount.client.tsx'
import { scriptedList } from './scripted-list.client.ts'
import {
  COMMITS, DETAIL, DIFF, hash, HISTORY_ROOT as ROOT, historyState, PAGE, REFS,
} from './history-fixtures.client.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh)
const TAB = 'tab-1' as TabId

describe('history helpers', () => {
  it('groups refs by commit tip, the attached branch first, then locals, remotes, and tags', () => {
    const refs: readonly WorkspaceGitRef[] = [
      { name: 'v2.0.0', refname: 'refs/tags/v2.0.0', kind: 'tag', hash: 'c' },
      { name: 'origin/dev', refname: 'refs/remotes/origin/dev', kind: 'remote', hash: 'a' },
      { name: 'origin/main', refname: 'refs/remotes/origin/main', kind: 'remote', hash: 'a' },
      { name: 'main', refname: 'refs/heads/main', kind: 'local', hash: 'a', head: true },
      { name: 'feature', refname: 'refs/heads/feature', kind: 'local', hash: 'a' },
      { name: 'v1.0.0', refname: 'refs/tags/v1.0.0', kind: 'tag', hash: 'b' },
    ]
    const tips = refsByCommit(refs)
    // The attached branch leads, then locals and remotes by name.
    expect(tips.get('a')?.map(ref => ref.name))
      .toEqual(['main', 'feature', 'origin/dev', 'origin/main'])
    expect(tips.get('b')?.map(ref => ref.name)).toEqual(['v1.0.0'])
    expect(tips.get('c')?.map(ref => ref.name)).toEqual(['v2.0.0'])
    expect(tips.get('missing')).toBeUndefined()
    expect(commitRefPills(tips.get('a')!, 2)).toEqual({
      shown: [refs[3], refs[4]], more: 2,
    })
    expect(commitRefPills([], 2)).toEqual({ shown: [], more: 0 })
  })

  it('strips the bidi controls a ref name may carry', () => {
    // git accepts bidi overrides inside a ref name, so a repository can hold a
    // tag that renders as a different name: an override and an isolate both go.
    expect(refDisplayName('spoof‮gnp.exe')).toBe('spoofgnp.exe')
    expect(refDisplayName('⁦main⁩')).toBe('main')
    expect(refDisplayName('feature/‫dir‬')).toBe('feature/dir')
    expect(refDisplayName('main')).toBe('main')
  })

  it('picks the changed file a commit page shows first', () => {    expect(pickHistoryFile(DETAIL.files)?.path).toBe('packages/app/src/a.ts')
    // A repository whose source tree is the working directory's own `src/`
    // reaches the same rule: its path carries no separator before the name.
    expect(pickHistoryFile([
      { path: 'docs/readme.md', display: 'docs/readme.md', kind: 'modified', added: 1, deleted: 0 },
      { path: 'src/main.ts', display: 'src/main.ts', kind: 'modified', added: 1, deleted: 0 },
    ])?.path).toBe('src/main.ts')
    expect(pickHistoryFile([
      { path: 'docs/readme.md', display: 'docs/readme.md', kind: 'modified', added: 1, deleted: 0 },
      { path: 'config.json', display: 'config.json', kind: 'modified', added: 1, deleted: 0 },
    ])?.path).toBe('config.json')
    expect(pickHistoryFile([
      { path: 'asset.bin', display: 'asset.bin', kind: 'modified', added: 0, deleted: 0, binary: true },
    ])?.path).toBe('asset.bin')
    expect(pickHistoryFile([])).toBeUndefined()
  })

  it('reads a changed file rename origin only while the detail is loaded', () => {
    const renamed = { ...DETAIL, files: [{ ...DETAIL.files[0]!, kind: 'renamed' as const, from: 'old.ts' }] }
    expect(renameOrigin(renamed, 'packages/app/src/a.ts')).toBe('old.ts')
    expect(renameOrigin(renamed, 'other.ts')).toBeUndefined()
    expect(renameOrigin('loading', 'packages/app/src/a.ts')).toBeUndefined()
    expect(renameOrigin('failed', 'packages/app/src/a.ts')).toBeUndefined()
    expect(renameOrigin(undefined, 'packages/app/src/a.ts')).toBeUndefined()
  })

  it('states relative time in each bucket and the yesterday day', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    const ago = (ms: number): string => new Date(now - ms).toISOString()
    expect(historyTime(ago(10_000), now, t)).toBe(zh['history.time.now'])
    expect(historyTime(ago(5 * 60_000), now, t)).toBe('5 分钟前')
    expect(historyTime(ago(3 * 3_600_000), now, t)).toBe('3 小时前')
    expect(historyTime(ago(2 * 86_400_000), now, t)).toBe('2 天前')
    expect(historyTime(ago(86_400_000), now, t)).toBe('昨天')
    expect(historyTime(ago(40 * 86_400_000), now, t)).toBe('1 个月前')
    expect(historyTime(ago(400 * 86_400_000), now, t)).toBe('1 年前')
  })

  it('states the absolute hover time through the locale template', () => {
    const at = new Date(2026, 9, 19, 8, 5).toISOString()
    expect(absoluteTime(at, t)).toBe('2026/10/19 08:05')
  })
})

describe('history slice', () => {
  it('seeds the history view with empty defaults and the history container selectable', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]?.history).toEqual(historyState())
    store.actions.containerSelected(TAB, 'history')
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('history')
  })

  it('records refs, their loading state, and a failure the filter can retry', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyRefsLoading(TAB)
    expect(store.getSnapshot().byTab[TAB]?.history.refsLoading).toBe(true)
    actions.historyRefsFailed(TAB)
    const failed = store.getSnapshot().byTab[TAB]!.history
    expect(failed.refsLoading).toBe(false)
    expect(failed.refsFailure).toBe(true)
    expect(failed.refs).toBeUndefined()
    actions.historyRefsLoading(TAB)
    actions.historyRefsLoaded(TAB, REFS)
    const loaded = store.getSnapshot().byTab[TAB]!.history
    expect(loaded.refsLoading).toBe(false)
    expect(loaded.refsFailure).toBe(false)
    expect(loaded.refs).toEqual(REFS)
  })

  it('walks a ref from the top, dropping the list and the shown commit page', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyRefsLoaded(TAB, REFS)
    actions.historyLoading(TAB)
    actions.historyLoaded(TAB, undefined, 0, 0, PAGE)
    actions.historyCommitSelected(TAB, hash('a'))
    actions.historyDetailLoading(TAB, hash('a'))
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    actions.historyFileSelected(TAB, DETAIL.files[0]!.path)
    actions.historyDiffLoaded(TAB, hash('a'), DETAIL.files[0]!.path, DIFF)
    actions.historyListScrolled(TAB, 120)
    actions.historyPageOpened(TAB, true)
    // A different ref restarts the list: pages, selection, and its page go.
    actions.historyRefSelected(TAB, 'dev')
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({
      ref: 'dev', commits: [], hasMore: false, loading: true, failure: false,
      selected: undefined, file: undefined, detail: undefined, diff: undefined,
      listScrollTop: 0, pageOpen: false,
    })
    // Selecting the ref already walked changes nothing.
    actions.historyLoaded(TAB, 'dev', 0, 0, PAGE)
    actions.historyRefSelected(TAB, 'dev')
    expect(store.getSnapshot().byTab[TAB]?.history.commits).toEqual(COMMITS)
  })

  it('returns to walking HEAD when the selected ref disappears from the answer', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyRefsLoaded(TAB, REFS)
    actions.historyRefSelected(TAB, 'dev')
    actions.historyLoaded(TAB, 'dev', 0, 0, PAGE)
    actions.historyCommitSelected(TAB, hash('a'))
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    const withoutDev: readonly WorkspaceGitRef[] = [REFS[1]!]
    actions.historyRefsLoaded(TAB, withoutDev)
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({
      ref: undefined, commits: [], hasMore: false, loading: false,
      selected: undefined, file: undefined, detail: undefined, pageOpen: false,
    })
  })

  it('replaces the first page and appends only the page that continues the list', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyRefsLoaded(TAB, REFS)
    actions.historyLoading(TAB)
    // An answer for another ref never lands in this list.
    actions.historyLoaded(TAB, 'dev', 0, 0, PAGE)
    expect(store.getSnapshot().byTab[TAB]?.history.commits).toEqual([])
    actions.historyLoaded(TAB, undefined, 0, 0, PAGE)
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({
      ref: undefined, commits: COMMITS, hasMore: true, loading: false, failure: false,
    })
    // A page that starts where the list ends appends; one that skips elsewhere
    // (a list the reader already replaced) is dropped.
    const older: WorkspaceGitCommit = {
      hash: hash('d'), short: 'ddddddd', parents: [], author: 'lead',
      authoredAt: '2026-10-16T08:00:00+08:00', subject: 'release: 0.9',
    }
    const next: WorkspaceGitHistory = { commits: [older], hasMore: false }
    actions.historyLoaded(TAB, undefined, COMMITS.length, 0, next)
    expect(store.getSnapshot().byTab[TAB]?.history.commits).toHaveLength(COMMITS.length + 1)
    // A ref that moved between pages re-serves a row the list already holds;
    // it is dropped so the row is drawn once, under one key.
    actions.historyLoading(TAB)
    actions.historyLoaded(TAB, undefined, COMMITS.length + 1, 0, { commits: [COMMITS[2]!, older], hasMore: false })
    expect(store.getSnapshot().byTab[TAB]?.history.commits.map(commit => commit.hash))
      .toEqual([...COMMITS.map(commit => commit.hash), older.hash])
    actions.historyLoading(TAB)
    const stale = store.getSnapshot().byTab[TAB]!.history.commits
    actions.historyLoaded(TAB, undefined, 5, 0, next)
    expect(store.getSnapshot().byTab[TAB]?.history.commits).toEqual(stale)
    // A page that does not continue the list states nothing about its rows,
    // and still ends the loading state of the read that asked for it.
    expect(store.getSnapshot().byTab[TAB]?.history.loading).toBe(false)
    // A failure keeps the loaded pages and marks them stale.
    actions.historyLoading(TAB)
    actions.historyFailed(TAB)
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({ loading: false, failure: true })
    actions.historyLoading(TAB)
    actions.historyLoaded(TAB, undefined, 0, 0, PAGE)
    expect(store.getSnapshot().byTab[TAB]?.history.failure).toBe(false)
  })

  it('drops a load-more whose list was replaced and walked back to', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyRefsLoaded(TAB, REFS)
    actions.historyLoaded(TAB, undefined, 0, 0, PAGE)
    // A load-more for skip 3 starts, then the reader walks another ref and
    // comes back: the same ref and the same offset hold again, at a new epoch.
    const epoch = store.getSnapshot().byTab[TAB]!.history.listEpoch
    actions.historyRefSelected(TAB, 'dev')
    actions.historyRefSelected(TAB, undefined)
    actions.historyLoaded(TAB, undefined, 0, 0, PAGE)
    const older: WorkspaceGitCommit = {
      hash: hash('d'), short: 'ddddddd', parents: [], author: 'lead',
      authoredAt: '2026-10-16T08:00:00+08:00', subject: 'release: 0.9',
    }
    actions.historyLoading(TAB)
    actions.historyLoaded(TAB, undefined, COMMITS.length, epoch, { commits: [older], hasMore: false })
    // The page belongs to the list that was replaced, so it appends nothing —
    // and still settles the loading state of the read that asked for it.
    expect(store.getSnapshot().byTab[TAB]?.history.commits).toEqual(COMMITS)
    expect(store.getSnapshot().byTab[TAB]?.history.loading).toBe(false)
  })

  it('shows one commit page, keeping a settled page on a repeated pick', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyCommitSelected(TAB, hash('a'))
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({ selected: hash('a'), detail: 'loading', diff: undefined })
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    actions.historyFileSelected(TAB, 'packages/app/src/a.ts')
    actions.historyDiffLoaded(TAB, hash('a'), 'packages/app/src/a.ts', DIFF)
    // Picking the shown commit again keeps its settled page.
    actions.historyCommitSelected(TAB, hash('a'))
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toEqual(DETAIL)
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
    // Picking another clears the page and asks for its detail.
    actions.historyCommitSelected(TAB, hash('b'))
    expect(store.getSnapshot().byTab[TAB]?.history).toMatchObject({
      selected: hash('b'), file: undefined, detail: 'loading', diff: undefined, pageScrollTop: 0,
    })
    // A failed page can be picked again, which starts a fresh read.
    actions.historyDetailFailed(TAB, hash('b'))
    actions.historyCommitSelected(TAB, hash('b'))
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toBe('loading')
  })

  it('keeps a commit page only for the shown commit and a comparison for its shown file', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyCommitSelected(TAB, hash('a'))
    actions.historyDetailLoading(TAB, hash('b'))
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toBe('loading')
    actions.historyDetailLoaded(TAB, hash('b'), DETAIL)
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toBe('loading')
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toEqual(DETAIL)
    // The page's selected file is cleared when the new detail no longer has it.
    actions.historyFileSelected(TAB, 'gone.ts')
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    expect(store.getSnapshot().byTab[TAB]?.history.file).toBeUndefined()
    // A detail that still holds the file keeps it.
    actions.historyFileSelected(TAB, 'packages/app/src/a.ts')
    actions.historyDetailLoaded(TAB, hash('a'), DETAIL)
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDiffLoaded(TAB, hash('a'), 'other.ts', DIFF)
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDiffLoaded(TAB, hash('b'), 'packages/app/src/a.ts', DIFF)
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDiffLoaded(TAB, hash('a'), 'packages/app/src/a.ts', DIFF)
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
    // A repeated pick keeps the settled comparison; a failed one can be retried.
    actions.historyFileSelected(TAB, 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
    actions.historyDiffLoading(TAB, hash('b'), 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
    actions.historyDiffLoading(TAB, hash('a'), 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDiffFailed(TAB, hash('b'), 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDiffFailed(TAB, hash('a'), 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('failed')
    actions.historyFileSelected(TAB, 'packages/app/src/a.ts')
    expect(store.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
    actions.historyDetailFailed(TAB, hash('b'))
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toEqual(DETAIL)
    actions.historyDetailFailed(TAB, hash('a'))
    expect(store.getSnapshot().byTab[TAB]?.history.detail).toBe('failed')
  })

  it('records the file fold, layout choice, ratio, offsets, and narrow drill-down', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.historyFilesToggled(TAB)
    expect(store.getSnapshot().byTab[TAB]?.history.filesOpen).toBe(false)
    actions.historyDiffModeSelected(TAB, 'split')
    expect(store.getSnapshot().byTab[TAB]?.history.diffMode).toBe('split')
    actions.historyRatioChanged(TAB, 0.05)
    expect(store.getSnapshot().byTab[TAB]?.history.ratio).toBe(0.2)
    actions.historyRatioChanged(TAB, 0.95)
    expect(store.getSnapshot().byTab[TAB]?.history.ratio).toBe(0.8)
    actions.historyRatioChanged(TAB, 0.62)
    expect(store.getSnapshot().byTab[TAB]?.history.ratio).toBe(0.62)
    actions.historyListScrolled(TAB, 140)
    expect(store.getSnapshot().byTab[TAB]?.history.listScrollTop).toBe(140)
    // A page offset belongs to the commit whose page was scrolled.
    actions.historyCommitSelected(TAB, hash('a'))
    actions.historyPageScrolled(TAB, hash('b'), 99)
    expect(store.getSnapshot().byTab[TAB]?.history.pageScrollTop).toBe(0)
    actions.historyPageScrolled(TAB, hash('a'), 99)
    expect(store.getSnapshot().byTab[TAB]?.history.pageScrollTop).toBe(99)
    actions.historyPageOpened(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.history.pageOpen).toBe(true)
    actions.historyPageOpened(TAB, false)
    expect(store.getSnapshot().byTab[TAB]?.history.pageOpen).toBe(false)
  })

  it('forgets the history slice with its tab and returns to files outside a repository', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.start('tab-2' as TabId, ROOT)
    actions.containerSelected(TAB, 'history')
    actions.historyRefsLoaded(TAB, REFS)
    // A failed or unavailable read keeps the history container retryable; a
    // directory that stops being a repository returns the workbench to files.
    actions.gitStatusLoaded(TAB, { kind: 'unavailable', entries: [], total: 0 })
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('history')
    actions.gitStatusLoaded(TAB, { kind: 'not-a-repository', entries: [], total: 0 })
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('files')
    actions.forget(TAB)
    expect(Object.keys(store.getSnapshot().byTab)).toEqual(['tab-2'])
  })
})

describe('history route validators', () => {
  it('accepts well-formed refs and rejects malformed ones', () => {
    expect(isGitRefs(REFS)).toBe(true)
    expect(isGitRefs([])).toBe(true)
    expect(isGitRefs([{ name: 'dev', refname: 'refs/heads/dev', kind: 'local', hash: hash('a'), head: true }]))
      .toBe(true)
    expect(isGitRefs('nope')).toBe(false)
    expect(isGitRefs([{ name: '', refname: 'refs/heads/dev', kind: 'local', hash: hash('a') }])).toBe(false)
    expect(isGitRefs([{ name: 'dev', refname: 'refs/heads/dev', kind: 'branch', hash: hash('a') }])).toBe(false)
    expect(isGitRefs([{ name: 'dev', refname: 'refs/heads/dev', kind: 'local', hash: 'abc' }])).toBe(false)
    expect(isGitRefs([{ name: 'dev', refname: 'refs/heads/dev', kind: 'local', hash: hash('a'), head: false }]))
      .toBe(false)
    // The walk names a full ref, so a bare display name is not a valid answer.
    expect(isGitRefs([{ name: 'dev', kind: 'local', hash: hash('a') }])).toBe(false)
    expect(isGitRefs([{ name: 'dev', refname: 'dev', kind: 'local', hash: hash('a') }])).toBe(false)
    expect(isGitRefs([{ name: 'dev', refname: 'refs/heads/', kind: 'local', hash: hash('a') }])).toBe(false)
    expect(isGitRefs([null])).toBe(false)
  })

  it('accepts well-formed pages and commits and rejects malformed ones', () => {
    expect(isGitHistory(PAGE)).toBe(true)
    expect(isGitHistory({ commits: [], hasMore: false })).toBe(true)
    expect(isGitHistory({ commits: [], hasMore: 'yes' })).toBe(false)
    expect(isGitHistory({ commits: [null], hasMore: false })).toBe(false)
    expect(isGitHistory(null)).toBe(false)
    const commit = COMMITS[0]!
    expect(isGitHistory({ commits: [{ ...commit, parents: 'none' }], hasMore: false })).toBe(false)
    expect(isGitHistory({ commits: [{ ...commit, parents: ['nope'] }], hasMore: false })).toBe(false)
    expect(isGitHistory({ commits: [{ ...commit, authoredAt: 'not a date' }], hasMore: false })).toBe(false)
    expect(isGitHistory({ commits: [{ ...commit, subject: 7 }], hasMore: false })).toBe(false)
    expect(isGitHistory({ commits: [{ ...commit, short: '' }], hasMore: false })).toBe(false)
  })

  it('accepts a well-formed commit detail and rejects malformed files and counts', () => {
    expect(isGitCommitDetail(DETAIL)).toBe(true)
    expect(isGitCommitDetail({ ...DETAIL, total: 1 })).toBe(false)
    expect(isGitCommitDetail({ ...DETAIL, total: 2.5 })).toBe(false)
    expect(isGitCommitDetail({ ...DETAIL, message: 7 })).toBe(false)
    expect(isGitCommitDetail({ ...DETAIL, commit: { ...COMMITS[0]!, hash: 'short' } })).toBe(false)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, kind: 'moved' }],
    })).toBe(false)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, path: '/abs' }],
    })).toBe(false)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, added: -1 }],
    })).toBe(false)
    expect(isGitCommitDetail({ ...DETAIL, files: [null] })).toBe(false)
    // A rename carries its origin; a binary file carries its marker.
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, kind: 'renamed', from: 'packages/app/old.ts' }],
    })).toBe(true)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, kind: 'renamed', from: '' }],
    })).toBe(false)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, kind: 'renamed', from: '/abs' }],
    })).toBe(false)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, binary: true, added: 0, deleted: 0 }],
    })).toBe(true)
    expect(isGitCommitDetail({
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, binary: false }],
    })).toBe(false)
    expect(isGitCommitDetail(null)).toBe(false)
  })
})

describe('face history reads', () => {
  /** A face over one store instance, with the listing and watching dependencies stubbed. */
  const faceOf = () => {
    const instance = createFilesStore().create()
    return { instance, face: filesFace(vi.fn() as never, vi.fn() as never)(SESSION, instance.actions) }
  }

  it('reads each history route and returns the validated answer with its generation', async () => {
    const { face } = faceOf()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('api/git.refs?')) return Response.json(REFS)
      if (url.startsWith('api/git.history?')) return Response.json(PAGE)
      if (url.startsWith('api/git.commit?')) return Response.json(DETAIL)
      return Response.json(DIFF)
    })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(face.historyRefs(TAB, ROOT, signal)).resolves.toEqual({ value: REFS, current: true })
    await expect(face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal)).resolves.toEqual({ value: PAGE, current: true })
    await expect(face.history(TAB, ROOT, { ref: 'dev', skip: 50, limit: 50 }, signal))
      .resolves.toEqual({ value: PAGE, current: true })
    await expect(face.commit(TAB, ROOT, hash('a'), signal)).resolves.toEqual({ value: DETAIL, current: true })
    await expect(face.commitDiff(TAB, ROOT, { hash: hash('a'), path: DIFF.path }, signal))
      .resolves.toEqual({ value: DIFF, current: true })
    await expect(face.commitDiff(TAB, ROOT, { hash: hash('a'), path: DIFF.path, from: 'old.ts' }, signal))
      .resolves.toEqual({ value: DIFF, current: true })
    const urls = fetchMock.mock.calls.map(call => call[0])
    expect(urls[0]).toBe(`api/git.refs?sessionId=${SESSION}&cwd=%2Fwork%2Fapp`)
    expect(urls[1]).toBe(`api/git.history?sessionId=${SESSION}&cwd=%2Fwork%2Fapp&skip=0&limit=50`)
    expect(urls[2]).toBe(`api/git.history?sessionId=${SESSION}&cwd=%2Fwork%2Fapp&skip=50&limit=50&ref=dev`)
    expect(urls[3]).toBe(`api/git.commit?sessionId=${SESSION}&cwd=%2Fwork%2Fapp&hash=${hash('a')}`)
    expect(urls[4]).toBe(`api/git.commit-diff?sessionId=${SESSION}&cwd=%2Fwork%2Fapp&hash=${hash('a')}&path=packages%2Fapp%2Fsrc%2Fa.ts`)
    expect(urls[5]).toBe(`api/git.commit-diff?sessionId=${SESSION}&cwd=%2Fwork%2Fapp&hash=${hash('a')}&path=packages%2Fapp%2Fsrc%2Fa.ts&from=old.ts`)
  })

  it('answers no value for a refused, malformed, mismatched, or failed read', async () => {
    const { face } = faceOf()
    const signal = new AbortController().signal
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(face.historyRefs(TAB, ROOT, signal)).resolves.toEqual({ value: undefined, current: true })
    await expect(face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal))
      .resolves.toEqual({ value: undefined, current: true })
    await expect(face.commit(TAB, ROOT, hash('a'), signal)).resolves.toEqual({ value: undefined, current: true })
    await expect(face.commitDiff(TAB, ROOT, { hash: hash('a'), path: 'a.ts' }, signal))
      .resolves.toEqual({ value: undefined, current: true })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'weird' })))
    await expect(face.historyRefs(TAB, ROOT, signal)).resolves.toEqual({ value: undefined, current: true })
    await expect(face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal))
      .resolves.toEqual({ value: undefined, current: true })
    await expect(face.commit(TAB, ROOT, hash('a'), signal)).resolves.toEqual({ value: undefined, current: true })
    await expect(face.commitDiff(TAB, ROOT, { hash: hash('a'), path: 'a.ts' }, signal))
      .resolves.toEqual({ value: undefined, current: true })
    // The answer must describe the commit and path that were asked for.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(
      url.startsWith('api/git.commit?')
        ? { ...DETAIL, commit: COMMITS[1]! }
        : { ...DIFF, path: 'other.ts' },
    )))
    await expect(face.commit(TAB, ROOT, hash('a'), signal)).resolves.toEqual({ value: undefined, current: true })
    await expect(face.commitDiff(TAB, ROOT, { hash: hash('a'), path: 'a.ts' }, signal))
      .resolves.toEqual({ value: undefined, current: true })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    for (const read of [
      face.historyRefs(TAB, ROOT, signal),
      face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal),
      face.commit(TAB, ROOT, hash('a'), signal),
      face.commitDiff(TAB, ROOT, { hash: hash('a'), path: 'a.ts' }, signal),
    ]) {
      await expect(read).resolves.toEqual({ value: undefined, current: true })
    }
  })

  it('keeps a settlement from the record a reused tab id replaced', async () => {
    const instance = createFilesStore().create()
    const script = scriptedList()
    const face = filesFace(script.list, script.watch)(SESSION, instance.actions)
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve) })))
    const signal = new AbortController().signal
    const first = new AbortController()
    face.start(TAB, ROOT, first.signal)
    const stream = await script.watches.ready(ROOT)
    const before = face.historyRefs(TAB, ROOT, signal)
    // The tab's record ends and a new one takes the same id: the settlement
    // still held by the record that ended must not match the new record's
    // first read of the same kind.
    first.abort()
    await stream.released.promise
    const second = new AbortController()
    face.start(TAB, ROOT, second.signal)
    const reopened = await script.watches.ready(ROOT, 1)
    const after = face.historyRefs(TAB, ROOT, signal)
    pending[1]!(Response.json(REFS))
    await expect(after).resolves.toEqual({ value: REFS, current: true })
    pending[0]!(Response.json(REFS))
    await expect(before).resolves.toEqual({ value: REFS, current: false })
    second.abort()
    await reopened.released.promise
    await script.dispose()
  })

  it('marks an answer a newer read of the same kind superseded', async () => {    const { face } = faceOf()
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve) })))
    const signal = new AbortController().signal
    const firstRefs = face.historyRefs(TAB, ROOT, signal)
    const secondRefs = face.historyRefs(TAB, ROOT, signal)
    pending[1]!(Response.json(REFS))
    await expect(secondRefs).resolves.toEqual({ value: REFS, current: true })
    pending[0]!(Response.json(REFS))
    await expect(firstRefs).resolves.toEqual({ value: REFS, current: false })
    const pendingList: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pendingList.push(resolve) })))
    const firstPage = face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal)
    const secondPage = face.history(TAB, ROOT, { skip: 0, limit: 50 }, signal)
    pendingList[1]!(Response.json(PAGE))
    await expect(secondPage).resolves.toEqual({ value: PAGE, current: true })
    pendingList[0]!(Response.json(PAGE))
    await expect(firstPage).resolves.toEqual({ value: PAGE, current: false })
    const pendingCommit: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pendingCommit.push(resolve) })))
    const firstCommit = face.commit(TAB, ROOT, hash('a'), signal)
    const secondCommit = face.commit(TAB, ROOT, hash('a'), signal)
    pendingCommit[1]!(Response.json(DETAIL))
    await expect(secondCommit).resolves.toEqual({ value: DETAIL, current: true })
    pendingCommit[0]!(Response.json(DETAIL))
    await expect(firstCommit).resolves.toEqual({ value: DETAIL, current: false })
    const pendingDiff: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pendingDiff.push(resolve) })))
    const firstDiff = face.commitDiff(TAB, ROOT, { hash: hash('a'), path: DIFF.path }, signal)
    const secondDiff = face.commitDiff(TAB, ROOT, { hash: hash('a'), path: DIFF.path }, signal)
    pendingDiff[1]!(Response.json(DIFF))
    await expect(secondDiff).resolves.toEqual({ value: DIFF, current: true })
    pendingDiff[0]!(Response.json(DIFF))
    await expect(firstDiff).resolves.toEqual({ value: DIFF, current: false })
  })
})
