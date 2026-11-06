import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
/**
 * Browser half: register `files` as a right-Sidebar tab type whose page is the
 * files workbench, the workspace navigator beside every file preview, and the
 * tree rows' menu arms. The navigator, the page body, and the toggle share one
 * store and one face per store instance. The package README lists the
 * registrations.
 */
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarRightTabNavigation } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FILES_ID, FILES_KIND, filesDefinition } from './definition.tsx'
import { canOpenOf, createList, createWatch, filesFace, type FilesInjected, type TreeRowMenus } from './face.ts'
import { FileTree } from './FileTree.tsx'
import { FileNavigator } from './FileNavigator.tsx'
import { FilesBody } from './FilesBody.tsx'
import { FilesTitle } from './FilesTitle.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'
import { NavigatorToggle } from './NavigatorToggle.tsx'
import { createFilesStore } from './store.ts'

export type { SidebarFilesKey } from './locales.ts'
export type { DirLevel, FilesPaneState, FilesState, FilesTabState, FilesTreeState, LevelState, OpenFile } from './store.ts'
export type { FilesInjected, ListWorkspaceDirectory, WorkspaceFilesListRemote } from './face.ts'
export type { FilesBodyProps } from './FilesBody.tsx'
// Also keeps the Factory declaration in this entry's emitted types, which an `import type {}` would not.
export type { TreeEntry, TreeEntryMeta, TreeEntryKind, TreeDirectoryState, FileTreeInput } from './FileTree.tsx'
export type { FileNavigatorInput } from './FileNavigator.tsx'
export type { NavigatorToggleInput } from './NavigatorToggle.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Workspace directory actions after the `files` page's reload control. */
    'sidebar.right.tab.files.actions': {
      kind: 'list'
      scope: 'session'
      owner: {
        /** Absolute directory path displayed by the file tree. */
        readonly absolutePath: string
      }
    }
    /**
     * Rows an open file's chip menu offers after the workbench's own arms, for
     * gestures the workbench does not own: handing a file's folder to the
     * desktop file manager, for instance. A tree row's menu is the shared
     * context menu's `file` target instead.
     */
    'sidebar.right.tab.files.chip.actions': {
      kind: 'list'
      scope: 'session'
      owner: {
        /** Absolute path of the file whose menu is open. */
        readonly path: string
        /** Dismiss the menu after the row's gesture settles, so a failure the row announces outlives the menu. */
        readonly onPicked: () => void
      }
    }
    /**
     * The file a `files` page's content column shows, drawn by the plugin that
     * owns document previews (ui-sidebar-documentpreview), so this package
     * depends on no document format.
     */
    'sidebar.right.tab.files.preview': {
      kind: 'single'
      scope: 'session'
      owner: {
        /** The shown file's `dsh-resource://file/...` address. */
        readonly address: string
        /** The preview's state key, one per `files` tab and file. */
        readonly viewKey: string
        /** The navigation the preview answers, as a tab's own would be. */
        readonly navigation: SidebarRightTabNavigation
        /** The open chip's preview lifetime (`FilesInjected.chipSignal`). */
        readonly signal: AbortSignal
        /** The pane the page is drawn in. */
        readonly paneId: PaneId
      }
    }
  }
}

/** This package's copy namespace. */
const NS = 'sidebarFiles'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its shortcut, its dictionaries, the
 * navigator and toggle Factories, the page body, its chip title, and, with
 * the shared context menu, the tree rows' menu arms.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const handle = createFilesStore()
  // Tree rows record their own gestures against the target value they raise (`FilesInjected.rowPressed`).
  const rows: TreeRowMenus = new WeakMap()
  const face = filesFace(createList(ctx.remote), createWatch(ctx.remote), canOpenOf(ctx.sidebarRightTabs), (sessionId, tabId) => {
    const source = ctx.sidebarRight.tabDomain.occurrence(sessionId, { id: tabId }).navigation
    return {
      getSnapshot: () => source.getSnapshot(),
      subscribe: listener => ctx.effect(() => {
        let active = true
        const unsubscribe = source.subscribe(() => {
          // The tab's navigation is recorded inside the layout operation; observe its committed drawing.
          queueMicrotask(() => { if (active) listener() })
        })
        return () => { active = false; unsubscribe() }
      }, 'ui-sidebar-files: tab navigation'),
    }
  }, rows)
  // A Factory runs its inject per occurrence, so each store instance gets its
  // one face when it is minted. The shortcut, which acts outside any body, finds
  // the face placed beside the target tab; a tab's loading and loaded drawings
  // each place it, so placements are counted, and the latest face placed wins.
  const faces = new WeakMap<object, FilesInjected>()
  const beside = new Map<SessionId, Map<TabId, { readonly face: FilesInjected; placed: number }>>()
  const place = (sessionId: SessionId) => (tabId: TabId, bound: FilesInjected): () => void => {
    const tabs = beside.get(sessionId) ?? new Map<TabId, { readonly face: FilesInjected; placed: number }>()
    beside.set(sessionId, tabs)
    const held = tabs.get(tabId)
    const entry = held?.face === bound ? held : { face: bound, placed: 0 }
    entry.placed += 1
    tabs.set(tabId, entry)
    let placed = true
    return () => {
      if (!placed) return
      placed = false
      entry.placed -= 1
      if (entry.placed > 0 || tabs.get(tabId) !== entry) return
      tabs.delete(tabId)
      if (tabs.size === 0) beside.delete(sessionId)
    }
  }
  const store: typeof handle = {
    ...handle,
    create: (scopeKey) => {
      const instance = handle.create(scopeKey)
      if (scopeKey === undefined) return instance
      const sessionId = scopeKey as SessionId
      faces.set(instance.actions, face(sessionId, instance, place(sessionId)))
      return instance
    },
  }
  const injectFace = (sessionId: SessionId, actions: BoundActions<typeof handle>): FilesInjected => {
    const bound = faces.get(actions)
    if (bound === undefined) throw new Error(`ui-sidebar-files: Session "${sessionId}" has no files store instance`)
    return bound
  }

  ctx.inject(['shortcuts'], (ctx) => {
    ctx.effect(() => ctx.shortcuts.register({
      id: 'workspace.files' as ShortcutCommandId, label: () => t('guide.title'), aliases: ['workspace files', 'files'],
      defaults: {
        'desktop:macos': { code: 'KeyP', modifiers: ['primary'] },
        'desktop:windows': { code: 'KeyP', modifiers: ['primary'] },
        'desktop:linux': { code: 'KeyP', modifiers: ['primary'] },
        'web:macos': { code: 'KeyP', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyP', modifiers: ['primary', 'alt'] },
      },
      // Each tab plugin owns its command's availability, localized refusal, and tab kind.
      /* jscpd:ignore-start */
      regions: ['page', 'editable', 'terminal'], modals: [],
      resolve: ({ target: element }) => {
        const target = ctx.sidebarRight.commandTarget(element)
        if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') }
        /* jscpd:ignore-end */
        return { status: 'handled', run: () => {
          // A docked tab with a navigator beside its content that can draw a tree keeps it: the navigator is shown and takes the keyboard.
          const placed = target.tabId === undefined ? undefined : beside.get(target.sessionId)?.get(target.tabId)
          if (target.host === 'dock' && placed !== undefined) {
            if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
            placed.face.focus(target.paneId)
            return
          }
          // Elsewhere the files page opens or is revealed and focused; its tree always shows.
          ctx.sidebarRight.openTabFromTarget(FILES_KIND, target)
        } }
      },
    }), 'ui-sidebar-files: shortcut')
  })
  // A tree row's own gestures join the shared menu: opening a file or toggling a
  // directory as its click does leads the menu, and its relative path follows
  // the absolute one other plugins offer.
  ctx.inject(['contextMenus'], (ctx) => {
    const copy = (text: string) => async (): Promise<void> => {
      await navigator.clipboard.writeText(text)
      ctx.contextMenus.notify(t('entry.menu.copied'), true)
    }
    ctx.effect(() => ctx.contextMenus.register({
      id: 'sidebar-files.file', target: 'file', order: 50,
      resolve: (value) => {
        const row = rows.get(value)
        return row?.kind === 'file' ? [{ id: 'open', label: t('entry.menu.open'), run: row.open }] : []
      },
    }), 'ui-sidebar-files: file row menu')
    ctx.effect(() => ctx.contextMenus.register({
      id: 'sidebar-files.directory', target: 'directory', order: 50,
      resolve: (value) => {
        const row = rows.get(value)
        return row?.kind === 'directory'
          ? [{ id: 'toggle', label: t(row.expanded ? 'entry.menu.collapse' : 'entry.menu.expand'), run: row.toggle }]
          : []
      },
    }), 'ui-sidebar-files: directory row menu')
    for (const target of ['file', 'directory'] as const) {
      ctx.effect(() => ctx.contextMenus.register({
        id: `sidebar-files.${target}.copy`, target, order: 150,
        resolve: (value: object) => {
          const row = rows.get(value)
          return row?.kind === target ? [{
            id: 'copyRelativePath', label: t('entry.menu.copyRelative'), failureLabel: t('entry.menu.copyFailed'),
            run: copy(row.relativePath),
          }] : []
        },
      }), `ui-sidebar-files: ${target} row path menu`)
    }
  })
  ctx.effect(() => ctx.sidebarRightTabs.register(filesDefinition(t)), 'ui-sidebar-files: files type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-sidebar-files: dictionaries')

  ctx.effect(() => ctx.slots.registerFactory({
    name: 'sidebar.files.tree', scope: 'root', locale: NS, slots: { accessory: { scope: 'root' } },
  }, FileTree), 'ui-sidebar-files: tree factory')
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'sidebar.files.navigator', scope: 'session', locale: NS, store, inject: injectFace,
  }, FileNavigator), 'ui-sidebar-files: navigator factory')
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'sidebar.files.navigator.toggle', scope: 'session', locale: NS, store, inject: injectFace,
  }, NavigatorToggle), 'ui-sidebar-files: navigator toggle factory')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab', key: FILES_ID, locale: NS, store, inject: injectFace,
      children: {
        'sidebar.right.tab.files.actions': { kind: 'list', scope: 'session' },
        'sidebar.right.tab.files.chip.actions': { kind: 'list', scope: 'session' },
        'sidebar.right.tab.files.preview': { kind: 'single', scope: 'session' },
      },
    },
    FilesBody,
  )), 'ui-sidebar-files: files tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: FILES_ID },
    FilesTitle,
  )), 'ui-sidebar-files: files tab title')
}
