/**
 * Mount the files page or a preview's navigator over a real store instance,
 * a real face, and a scripted listing.
 *
 * Unused Factory framework props throw if called. The row the navigator
 * measures reports a width the spec sets, because jsdom lays nothing out. The
 * git and history reads, which the face makes over HTTP, answer what the spec
 * scripts.
 */
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { onTestFinished, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabActions, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TreeFixture } from './tree-fixture.client.tsx'
import type { FileTreeInput } from '../src/client/FileTree.tsx'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { filesFace } from '../src/client/face.ts'
import type { FilesInjected, GitRead, TreeRowMenus } from '../src/client/face.ts'
import { FileNavigator } from '../src/client/FileNavigator.tsx'
import { FilesBody } from '../src/client/FilesBody.tsx'
import type { FilesBodyProps } from '../src/client/FilesBody.tsx'
import { NavigatorToggle } from '../src/client/NavigatorToggle.tsx'
import { zh } from '../src/client/locales.ts'
import { createFilesStore } from '../src/client/store.ts'
import type { FilesStoreInstance } from '../src/client/store.ts'
import type {
  WorkspaceFileDiff, WorkspaceGitCommitDetail, WorkspaceGitCommitDiffRequest, WorkspaceGitDiffRequest,
  WorkspaceGitHistory, WorkspaceGitHistoryRequest, WorkspaceGitRef, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import { scriptedList } from './scripted-list.client.ts'
import type { ScriptedList } from './scripted-list.client.ts'

export const SESSION = 's-test' as SessionId
export const ROOT = '/work/app'
export const TAB = 'tab-1' as TabId
export const PANE = 'pane-1' as PaneId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** The owner's tab actions as recording mocks. */
interface MockedTabActions {
  readonly bindCommands: Mock<SidebarRightTabActions['bindCommands']>
  readonly openResource: Mock<SidebarRightTabActions['openResource']>
  readonly openTab: Mock<SidebarRightTabActions['openTab']>
  readonly close: Mock<SidebarRightTabActions['close']>
}

/** Scripted answers for the working-tree reads a mount should see. */
export interface MountedGit {
  readonly status?: WorkspaceGitStatus
  readonly diff?: WorkspaceFileDiff
}

/** Scripted answers for the history reads a mount should see. */
export interface MountedHistory {
  readonly refs?: readonly WorkspaceGitRef[]
  readonly history?: WorkspaceGitHistory
  readonly commit?: WorkspaceGitCommitDetail
  readonly commitDiff?: WorkspaceFileDiff
}

/** What the tab and its pane look like to the components; a spec may change it and rerender. */
export interface Placement {
  contentId: string
  isFloating?: boolean
  /** The tab drawing; a spec changes it, with `signal`, to replace the tab in the same pane. */
  tabId: TabId
  /** The drawing tab's lifetime. */
  signal: AbortSignal
  refreshShortcut?: SidebarRightTabInfo['tab']['refreshShortcut']
  /** The session's working directory as `useSessions` reports it; `null` for a session without one. */
  cwd: string | null
  /** Whether the Sidebar is expanded; expanded unless set. */
  sidebarExpanded?: boolean
  /** Whether the tab is on screen; visible unless set. */
  visible?: boolean
}

/** What a spec holds after mounting: the rendered view and every hand on the tree. */
export interface Mounted {
  readonly shared: ReturnType<typeof harness>['shared']
  readonly view: RenderResult
  readonly instance: FilesStoreInstance
  readonly script: ScriptedList
  readonly face: FilesInjected
  /** The tree rows' recorded menu arms, as the plugin's menu contributions read them. */
  readonly rows: TreeRowMenus
  /** The first tab's lifetime. */
  readonly controller: AbortController
  /** Whether a registered tab type opens files; `set` it and every drawing hears it. */
  readonly viewers: { readonly set: (open: boolean) => void }
  readonly tabActions: MockedTabActions
  readonly onOpen: Mock<(address: string, path: string) => void>
  /** The tab's address and the pane's presentation, read on every render. */
  readonly placement: Placement
  /** The width the navigator's row reports. */
  readonly row: ReturnType<typeof measureRows>['row']
  /** The fullscreen media query, notified independently of row measurements. */
  readonly viewport: ReturnType<typeof measureRows>['viewport']
  /** Whether a navigator that can draw a tree has the face placed beside a tab's content. */
  readonly beside: (tabId: TabId) => boolean
  /** Render again in place, after changing `placement` or `row`. */
  readonly rerender: () => void
  /** Render a fresh drawing over the same store and face, as a tab switch remounts it. */
  readonly remount: () => RenderResult
  /** The page's child-slot renderer, recording what the page asked for. */
  readonly renderSlot: Mock
  /** The scripted working-tree status read the page sees. */
  readonly gitStatus: Mock<(tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<WorkspaceGitStatus>>>
  /** The scripted comparison read the page sees. */
  readonly gitDiff: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>>
  /** The scripted refs read the page sees. */
  readonly historyRefs: Mock<(tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<readonly WorkspaceGitRef[]>>>
  /** The scripted history page read the page sees. */
  readonly history: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitHistory>>>
  /** The scripted commit detail read the page sees. */
  readonly commit: Mock<(
    tabId: TabId, cwd: string, hash: string, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitCommitDetail>>>
  /** The scripted commit file comparison read the page sees. */
  readonly commitDiff: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>>
}

/** One store instance, one face, one owner share. */
function harness(placement: Placement, controller: AbortController, git: MountedGit, history: MountedHistory) {
  const instance = createFilesStore().create()
  const script = scriptedList()
  // Whether some tab type opens files: one predicate per answer, as registrations change it.
  const listeners = new Set<() => void>()
  let check = (_address: string): boolean => true
  const viewers = {
    set: (open: boolean): void => {
      check = () => open
      for (const listener of listeners) listener()
    },
  }
  const canOpen = {
    getSnapshot: () => check,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  // The owner's count of drawings that placed the face beside each tab.
  const placed = new Map<TabId, number>()
  const navigation = createSnapshotStore({ address: placement.contentId, params: undefined, revision: 0 })
  const rows: TreeRowMenus = new WeakMap()
  const real = filesFace(script.list, script.watch, canOpen, () => navigation, rows)(SESSION, instance, (tabId) => {
    placed.set(tabId, (placed.get(tabId) ?? 0) + 1)
    return () => { placed.set(tabId, placed.get(tabId)! - 1) }
  })
  const beside = (tabId: TabId): boolean => (placed.get(tabId) ?? 0) > 0
  // The git and history reads go through the Host over HTTP; specs script their
  // answers instead of reaching for a network, and leave one unset for "no answer".
  const gitStatus = vi.fn<FilesInjected['gitStatus']>(async () => ({ value: undefined, current: true }))
  const gitDiff = vi.fn<FilesInjected['gitDiff']>(async () => ({ value: undefined, current: true }))
  if (git.status !== undefined) gitStatus.mockResolvedValue({ value: git.status, current: true })
  if (git.diff !== undefined) gitDiff.mockResolvedValue({ value: git.diff, current: true })
  const historyRefs = vi.fn<FilesInjected['historyRefs']>(async () => ({ value: undefined, current: true }))
  const historyRead = vi.fn<FilesInjected['history']>(async () => ({ value: undefined, current: true }))
  const commit = vi.fn<FilesInjected['commit']>(async () => ({ value: undefined, current: true }))
  const commitDiff = vi.fn<FilesInjected['commitDiff']>(async () => ({ value: undefined, current: true }))
  if (history.refs !== undefined) historyRefs.mockResolvedValue({ value: history.refs, current: true })
  if (history.history !== undefined) historyRead.mockResolvedValue({ value: history.history, current: true })
  if (history.commit !== undefined) commit.mockResolvedValue({ value: history.commit, current: true })
  if (history.commitDiff !== undefined) commitDiff.mockResolvedValue({ value: history.commitDiff, current: true })
  const face: FilesInjected = { ...real, gitStatus, gitDiff, historyRefs, history: historyRead, commit, commitDiff }
  onTestFinished(async () => {
    controller.abort()
    await script.dispose()
  })
  const tabActions: MockedTabActions = {
    bindCommands: vi.fn(() => vi.fn()),
    openResource: vi.fn<SidebarRightTabActions['openResource']>(),
    openTab: vi.fn<SidebarRightTabActions['openTab']>(),
    close: vi.fn<SidebarRightTabActions['close']>(),
  }
  const sessionsAt = (cwd: string | null): SessionListState =>
    ({ byId: cwd === null ? {} : { [SESSION]: { cwd } } } as unknown as SessionListState)
  const useTabInfo = (): SidebarRightTabInfo => ({
    sidebar: { expanded: placement.sidebarExpanded ?? true, fullscreen: false },
    panel: { id: PANE, isFloating: placement.isFloating ?? false },
    tab: {
      id: placement.tabId, kind: 'files', contentId: placement.contentId, title: zh['type.label'],
      visible: placement.visible ?? true,
      navigation: { address: placement.contentId, params: undefined, revision: 1 },
      signal: placement.signal,
      actions: tabActions, refreshShortcut: placement.refreshShortcut,
    },
  })
  const { hooks, keyedHooks, ...members } = face
  const t = makeTranslate(zh)
  const onOpen = vi.fn<(address: string, path: string) => void>()
  const openMenu = vi.fn()
  // The chip menu's contributed rows and the preview seat render markers a spec
  // can pick, the way a feature plugin's fill would; every other seat stays empty.
  const renderSlot = vi.fn((name: string, props?: object): ReactNode => {
    if (name === 'sidebar.right.tab.files.chip.actions') {
      const { path, onPicked } = props as { readonly path: string; readonly onPicked: () => void }
      return <button type="button" role="menuitem" data-chip-row={path} onClick={() => { onPicked() }}>Show file location</button>
    }
    if (name === 'sidebar.right.tab.files.preview') {
      return <div data-preview-address={(props as { readonly address: string }).address} />
    }
    return null
  })
  const shared = {
    onOpen,
    useTabInfo,
    renderSlot,
    openMenu,
    useContextMenu: contextMenuHook(openMenu),
    renderFactorySlot: (name: string, input: object) => name === 'sidebar.files.tree' ? <TreeFixture {...input as FileTreeInput} t={t} /> : null,
    sessionId: SESSION,
    useSessions: <S,>(sel: (s: SessionListState) => S) => sel(sessionsAt(placement.cwd)),
    useStore: hookOf(instance),
    actions: instance.actions,
    ...members,
    useRowWidth: (paneId: string) => {
      const source = keyedHooks.rowWidth(paneId)
      return useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot())
    },
    useCanOpen: <S,>(sel: (check: (address: string) => boolean) => S) =>
      sel(useSyncExternalStore(listener => hooks.canOpen.subscribe(listener), () => hooks.canOpen.getSnapshot())),
    t,
  }
  return {
    instance, script, face, rows, controller, viewers, tabActions, onOpen, beside, shared, renderSlot,
    gitStatus, gitDiff, historyRefs, historyRead, commit, commitDiff,
  }
}

/**
 * Report the spec's row width for the rows a navigator measures: the
 * preview's row this harness draws, and the files page's content row.
 * @param recordObservers - capture navigator notifications; page specs may provide their own observers.
 * @returns independently controlled row measurements and fullscreen media changes.
 */
function measureRows(recordObservers: boolean) {
  const callbacks = new Set<() => void>()
  class RecordingResizeObserver implements ResizeObserver {
    private readonly report: () => void
    constructor(callback: ResizeObserverCallback) {
      this.report = () => { callback([], this) }
      callbacks.add(this.report)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { callbacks.delete(this.report) }
  }
  const row = {
    width: 900,
    observers: callbacks,
    report(width: number): void {
      row.width = width
      for (const callback of callbacks) callback()
    },
  }
  const viewport = Object.assign(new EventTarget(), {
    matches: false,
    report(matches: boolean): void {
      viewport.matches = matches
      viewport.dispatchEvent(new Event('change'))
    },
  })
  if (recordObservers) {
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver)
    vi.stubGlobal('matchMedia', () => viewport)
    onTestFinished(() => { vi.unstubAllGlobals() })
  }
  // jsdom lays nothing out, so every other box is empty as it would be anyway.
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.matches('[data-test-row], [data-files-content]') ? row.width : 0
    return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: width, width, height: 0, toJSON: () => ({}) }
  })
  onTestFinished(() => { spy.mockRestore() })
  return { row, viewport }
}

function unusedFrameworkProp(): never {
  throw new Error('Unexpected Factory framework prop call')
}

const unusedFactoryProps = {
  useFactorySlot: unusedFrameworkProp,
  useSession: unusedFrameworkProp,
  useProjection: unusedFrameworkProp,
  useAccess: unusedFrameworkProp,
  useSessionStatus: unusedFrameworkProp,
  useSessionRetainInfo: unusedFrameworkProp,
  useSessionAccess: unusedFrameworkProp,
  useWorkspaces: unusedFrameworkProp,
  useWorkspaceAccess: unusedFrameworkProp,
  useRemoteAccess: unusedFrameworkProp,
  usePanelInfo: unusedFrameworkProp,
  useResource: unusedFrameworkProp,
  useConversation: unusedFrameworkProp,
  useInput: unusedFrameworkProp,
  useChat: unusedFrameworkProp,
  useTrajectory: unusedFrameworkProp,
  inputActions: {
    insertQuote: unusedFrameworkProp,
    captureInsertion: unusedFrameworkProp,
    insertText: unusedFrameworkProp,
    setDraft: unusedFrameworkProp,
    persistDraft: unusedFrameworkProp,
    addAttachments: unusedFrameworkProp,
    removeAttachment: unusedFrameworkProp,
    pruneAttachments: unusedFrameworkProp,
    submit: unusedFrameworkProp,
  },
}

type NavigatorProps = FactoryComponentPropsOf<'sidebar.files.navigator'>

/**
 * Complete the shared Factory props without the occurrence's `page` input.
 * @param shared - the harness's typed data, hooks, actions, and copy.
 * @returns props shared by the navigator and its toggle.
 */
function factoryProps(
  shared: Omit<NavigatorProps, keyof typeof unusedFactoryProps | 'page'>,
) {
  return { ...unusedFactoryProps, ...shared } satisfies Omit<NavigatorProps, 'page'>
}

/**
 * The framework-injected kit the files page receives, of which it reads only
 * the part `harness` builds.
 * @param shared - the harness props with the page's Factory renderer.
 * @returns the page's declared props.
 */
function bodyProps(shared: object): FilesBodyProps {
  return shared as unknown as FilesBodyProps
}

/**
 * Mount one drawing and wire its rerender and remount.
 * @param given - the tab's address, the pane's presentation, and the session's working directory.
 * @param draw - the drawing over the shared props.
 * @param recordObservers - capture navigator measurement notifications.
 * @param git - the working-tree reads' scripted answers.
 * @param history - the history reads' scripted answers.
 * @returns the mounted hands.
 */
function mount(
  given: Omit<Placement, 'tabId' | 'signal'>,
  draw: (shared: ReturnType<typeof harness>['shared']) => ReactNode,
  recordObservers = false,
  git: MountedGit = {},
  history: MountedHistory = {},
): Mounted {
  const controller = new AbortController()
  const placement: Placement = { ...given, tabId: TAB, signal: controller.signal }
  const { shared, historyRead, ...hands } = harness(placement, controller, git, history)
  const { row, viewport } = measureRows(recordObservers)
  const element = (): ReactNode => <div data-test-row>{draw(shared)}</div>
  const view = render(element())
  return {
    ...hands, history: historyRead, shared, view, placement, row, viewport,
    rerender: () => { view.rerender(element()) },
    remount: () => render(element()),
  }
}

/**
 * Mount the `files` page, whose Factory slot draws the real navigator.
 * @param cwd - the session's working directory; `null` for a session without one.
 * @param placement - the pane's presentation, the tab's visibility, and its refresh binding.
 * @param git - the working-tree reads' scripted answers.
 * @param history - the history reads' scripted answers.
 * @returns the mounted hands.
 */
export function mountBody(
  cwd: string | null = ROOT,
  placement: Partial<Placement> = {},
  git: MountedGit = {},
  history: MountedHistory = {},
): Mounted {
  return mount({ contentId: 'sidebar://files', ...placement, cwd }, (shared) => {
    // The Factory occurrence receives the same store and face as the page.
    const renderFactorySlot = (
      name: string, input: Pick<NavigatorProps, 'useTabInfo' | 'page' | 'onOpen' | 'current'>,
    ): ReactNode => name === 'sidebar.files.navigator'
      ? <FileNavigator {...factoryProps(shared)} {...input} />
      : null
    return <FilesBody {...bodyProps({ ...shared, renderFactorySlot })} />
  }, false, git, history)
}

/**
 * Mount a preview's navigator and its toggle, as the document preview renders their Factories.
 * @param contentId - the previewed file's address.
 * @param placement - the pane's presentation.
 * @param cwd - the session's working directory; `null` for a session without one.
 * @returns the mounted hands.
 */
export function mountNavigator(contentId: string, placement: Partial<Placement> = {}, cwd: string | null = ROOT): Mounted {
  return mount({ contentId, ...placement, cwd }, shared => (
    <>
      <NavigatorToggle {...factoryProps(shared)} />
      {/* The slot renderer wraps an occurrence without a box of its own. */}
      <div style={{ display: 'contents' }}>
        <FileNavigator {...factoryProps(shared)} page={false} />
      </div>
    </>
  ), true)
}
