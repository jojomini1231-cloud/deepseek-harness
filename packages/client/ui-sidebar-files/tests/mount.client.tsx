/**
 * Mount the body over a real store instance and a scripted listing.
 *
 * The component reads a handful of its props; the rest of the standard kit is
 * framework-injected and never touched here, so one documented cast keeps the
 * harness to what is actually exercised.
 */
import { createElement, useSyncExternalStore } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { onTestFinished, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { filesFace } from '../src/client/face.ts'
import type { FilesInjected, GitRead } from '../src/client/face.ts'
import { FilesBody } from '../src/client/FilesBody.tsx'
import type { FilesBodyProps } from '../src/client/FilesBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createFilesStore } from '../src/client/store.ts'
import type {
  WorkspaceFileDiff, WorkspaceGitCommitDetail, WorkspaceGitCommitDiffRequest, WorkspaceGitDiffRequest,
  WorkspaceGitHistory, WorkspaceGitHistoryRequest, WorkspaceGitRef, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import { scriptedList } from './scripted-list.client.ts'
import type { ScriptedList } from './scripted-list.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

export const SESSION = 's-test' as SessionId
export const ROOT = '/work/app'
export const TAB = 'tab-1' as TabId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** A live instance of the tree's store, as the framework would mint one per session. */
type FilesStoreInstance = ReturnType<ReturnType<typeof createFilesStore>['create']>

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

/** What a spec holds after mounting: the rendered view and every hand on the tree. */
export interface Mounted {
  readonly view: RenderResult
  readonly instance: FilesStoreInstance
  readonly script: ScriptedList
  readonly face: FilesInjected
  readonly controller: AbortController
  readonly tabActions: MockedTabActions
  /** Render a fresh body over the same store and face, as a tab switch remounts it. */
  readonly remount: () => RenderResult
  /** The reusable preview Factory's renderer, recording what the body asked for. */
  readonly renderFactorySlot: Mock
  /** The body's child-slot renderer, recording what the body asked for. */
  readonly renderSlot: Mock
  /** The scripted working-tree status read the body sees. */
  readonly gitStatus: Mock<(tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<WorkspaceGitStatus>>>
  /** The scripted comparison read the body sees. */
  readonly gitDiff: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>>
  /** The scripted refs read the body sees. */
  readonly historyRefs: Mock<(tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<readonly WorkspaceGitRef[]>>>
  /** The scripted history page read the body sees. */
  readonly history: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitHistory>>>
  /** The scripted commit detail read the body sees. */
  readonly commit: Mock<(
    tabId: TabId, cwd: string, hash: string, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitCommitDetail>>>
  /** The scripted commit file comparison read the body sees. */
  readonly commitDiff: Mock<(
    tabId: TabId, cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>>
}

/** One store instance, one face, one owner share. */
function harness(
  cwd: string | null,
  refreshShortcut?: ReturnType<FilesBodyProps['useTabInfo']>['tab']['refreshShortcut'],
  git?: MountedGit,
  panel?: { readonly expanded?: boolean; readonly visible?: boolean },
  history?: MountedHistory,
) {
  const instance = createFilesStore().create()
  const script = scriptedList()
  const real = filesFace(script.list, script.watch)(SESSION, instance.actions)
  // The git reads go through the Host over HTTP; specs script their answers
  // instead of reaching for a network, and pass undefined for "no answer".
  const gitStatus = vi.fn<FilesInjected['gitStatus']>(async () => ({ value: undefined, current: true }))
  const gitDiff = vi.fn<FilesInjected['gitDiff']>(async () => ({ value: undefined, current: true }))
  if (git?.status !== undefined) gitStatus.mockResolvedValue({ value: git.status, current: true })
  if (git?.diff !== undefined) gitDiff.mockResolvedValue({ value: git.diff, current: true })
  // The history reads go through the same Host routes; specs script them too.
  const historyRefs = vi.fn<FilesInjected['historyRefs']>(async () => ({ value: undefined, current: true }))
  const historyRead = vi.fn<FilesInjected['history']>(async () => ({ value: undefined, current: true }))
  const commit = vi.fn<FilesInjected['commit']>(async () => ({ value: undefined, current: true }))
  const commitDiff = vi.fn<FilesInjected['commitDiff']>(async () => ({ value: undefined, current: true }))
  if (history?.refs !== undefined) historyRefs.mockResolvedValue({ value: history.refs, current: true })
  if (history?.history !== undefined) historyRead.mockResolvedValue({ value: history.history, current: true })
  if (history?.commit !== undefined) commit.mockResolvedValue({ value: history.commit, current: true })
  if (history?.commitDiff !== undefined) commitDiff.mockResolvedValue({ value: history.commitDiff, current: true })
  const face: FilesInjected = { ...real, gitStatus, gitDiff, historyRefs, history: historyRead, commit, commitDiff }
  const controller = new AbortController()
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
  const sessions = { byId: cwd === null ? {} : { [SESSION]: { cwd } } } as unknown as SessionListState
  const shared = {
    // A page tab's address is the shell's to mint; the body never reads it.
    useTabInfo: () => ({
      sidebar: { expanded: panel?.expanded ?? true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: 'files', contentId: 'files', title: zh['type.label'], visible: panel?.visible ?? true,
        navigation: { address: 'files', params: undefined, revision: 1 },
        signal: controller.signal,
        actions: tabActions, refreshShortcut,
      },
    }),
    // The chip menu's contributed rows render a marker the body spec can pick,
    // the way a feature plugin's row would; every other slot stays empty.
    renderSlot: vi.fn((name: string, props?: { readonly path?: string; readonly onPicked?: () => void }) =>
      name === 'sidebar.right.tab.files.chip.actions' && props?.path !== undefined
        ? createElement('button', {
          type: 'button',
          role: 'menuitem',
          'data-chip-row': props.path,
          onClick: () => { props?.onPicked?.() },
        }, 'Show file location')
        : null),
    renderFactorySlot: vi.fn((name: string, input: { address: string }) => name === 'sidebar.document.preview'
      ? createElement('div', { 'data-preview-address': input.address })
      : null),
    sessionId: SESSION,
    useSessions: <S,>(sel: (s: SessionListState) => S) => sel(sessions),
    useStore: hookOf(instance),
    actions: instance.actions,
    ...face,
    t: makeTranslate(zh),
  }
  return { instance, script, face, controller, tabActions, shared, gitStatus, gitDiff, historyRefs, historyRead, commit, commitDiff }
}

/**
 * Mount the body.
 * @param cwd - the session's working directory as `useSessions` reports it; `null` for a session without one.
 * @param refreshShortcut - effective binding advertised by the tab owner.
 */
export function mountBody(
  cwd: string | null = ROOT,
  refreshShortcut?: ReturnType<FilesBodyProps['useTabInfo']>['tab']['refreshShortcut'],
  git?: MountedGit,
  panel?: { readonly expanded?: boolean; readonly visible?: boolean },
  history?: MountedHistory,
): Mounted {
  const { shared, historyRead, ...hands } = harness(cwd, refreshShortcut, git, panel, history)
  const view = render(<FilesBody {...shared as unknown as FilesBodyProps} />)
  return {
    ...hands, history: historyRead, view,
    renderFactorySlot: shared.renderFactorySlot, renderSlot: shared.renderSlot,
    remount: () => render(<FilesBody {...shared as unknown as FilesBodyProps} />),
  }
}
