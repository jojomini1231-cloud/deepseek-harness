/**
 * The workspace tree's rows: one level at a time, drawn from what the store
 * already holds.
 *
 * A directory that was never asked for shows nothing, a listing in flight shows
 * its note, and a settled level shows its entries. The gestures are the
 * caller's: a directory toggles, a file opens, and a secondary press on either
 * row opens that row's menu — what to open, and the two path copies. An optional
 * active path marks the row whose file the content column shows.
 *
 * The tree holds the one row menu itself: which row opened it and where the
 * press landed describe the drawing rather than the tab, so opening a menu never
 * writes the store nor re-renders the workbench around the tree.
 */
import { useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import {
  FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, Menu, classifyFileType, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { childPath } from './face.ts'
import type {} from './locales.ts'
import type { FilesTabState } from './store.ts'
import css from './FilesBody.module.css'

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/** What every level shares: the tab's tree, the shown file, the gestures, and the row menu. */
export interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (parent: string, path: string) => void
  readonly onOpen: (path: string) => void
  /**
   * Rows other plugins contribute to a row's menu, rendered after the
   * workbench's own arms; absent means none. The callback dismisses the menu, so
   * a contributed surface closes it on the workbench's behalf.
   */
  readonly renderMenuRow?: (path: string, onPicked: () => void) => ReactNode
  readonly t: TranslateNS<'sidebarFiles'>
}

/** What a row's secondary press names: the row itself, and the arms its menu offers. */
interface RowPress {
  /** Absolute path of the pressed row. */
  readonly path: string
  /** Absolute path of the directory the row is listed under. */
  readonly parent: string
  readonly kind: 'file' | 'directory'
  /** Whether the pressed directory's level is open; a file row leaves it false. */
  readonly expanded: boolean
}

/** The row whose menu is open: the press that opened it, and where it landed. */
interface OpenRowMenu extends RowPress {
  /** The menu's anchor: an empty box at the press point, so the list opens where the press did. */
  readonly rect: DOMRect
}

/** The tree's one row menu: which row owns it, and the two gestures that move or end it. */
interface RowMenu {
  readonly open: OpenRowMenu | undefined
  /** Open this row's menu at the press, or close it when it is already this row's. */
  readonly press: (row: RowPress, event: MouseEvent<HTMLElement>) => void
  readonly dismiss: () => void
}

/**
 * One row's path as the reader names it inside the workspace.
 * @param root - the tree's absolute workspace root.
 * @param path - the row's absolute path, joined from the root by `childPath`.
 * @returns the path with the root's prefix removed, ready to paste into a prompt or a command.
 */
function relativePathOf(root: string, path: string): string {
  return path.slice(`${root.replace(/[/\\]+$/, '')}/`.length)
}

/**
 * The rows a file row's menu offers.
 * @param t - namespace-bound translate.
 * @returns the menu entries, in the order the reader sees them.
 */
function fileMenu(t: TranslateNS<'sidebarFiles'>): readonly MenuEntry[] {
  return [
    { id: 'open', label: t('entry.menu.open') },
    { type: 'separator', id: 'paths' },
    { id: 'copy-path', label: t('entry.menu.copyPath') },
    { id: 'copy-relative', label: t('entry.menu.copyRelative') },
  ]
}

/**
 * The rows a directory row's menu offers. The toggle row names the press's
 * effect, so an expanded directory reads "Collapse" rather than "Toggle".
 * @param t - namespace-bound translate.
 * @param expanded - whether the directory's level is open now.
 * @returns the menu entries, in the order the reader sees them.
 */
function directoryMenu(t: TranslateNS<'sidebarFiles'>, expanded: boolean): readonly MenuEntry[] {
  return [
    { id: 'toggle', label: t(expanded ? 'entry.menu.collapse' : 'entry.menu.expand') },
    { type: 'separator', id: 'paths' },
    { id: 'copy-path', label: t('entry.menu.copyPath') },
    { id: 'copy-relative', label: t('entry.menu.copyRelative') },
  ]
}

/**
 * Run one file row's menu arm.
 * @param id - the row the reader picked.
 * @param path - the row's absolute path.
 * @param tree - the tab's tree and its gestures.
 */
function pickFileRow(id: string, path: string, tree: TreeContext): void {
  switch (id) {
    case 'open': tree.onOpen(path); return
    case 'copy-path': void writeClipboard(path); return
    case 'copy-relative': void writeClipboard(relativePathOf(tree.state.root, path)); return
    /* v8 ignore next -- closed union of the menu's own ids. */
    default: return
  }
}

/**
 * Run one directory row's menu arm.
 * @param id - the row the reader picked.
 * @param parent - absolute path of the directory the row is listed under.
 * @param path - the directory's absolute path.
 * @param tree - the tab's tree and its gestures.
 */
function pickDirectoryRow(id: string, parent: string, path: string, tree: TreeContext): void {
  switch (id) {
    case 'toggle': tree.onToggle(parent, path); return
    case 'copy-path': void writeClipboard(path); return
    case 'copy-relative': void writeClipboard(relativePathOf(tree.state.root, path)); return
    /* v8 ignore next -- closed union of the menu's own ids. */
    default: return
  }
}

/**
 * One row's menu: the arms the workbench offers, then the contributed rows,
 * anchored at the press that opened it. The press point never moves while this
 * is the open menu, so the anchor callback keeps its identity across renders and
 * the list is placed once.
 *
 * It draws beside the rows rather than inside one: the list is portalled, so
 * what the rows hold is their own button, and a menu opening never changes a
 * row's box — the wrapper class keeps this element's own box out of the
 * scroller's flow.
 */
function RowMenu({ rect, items, onSelect, onClose, children }: {
  readonly rect: DOMRect
  readonly items: readonly MenuEntry[]
  readonly onSelect: (id: string) => void
  readonly onClose: () => void
  readonly children: ReactNode
}): ReactNode {
  const getAnchorRect = useMemo(() => (): DOMRect => rect, [rect])
  return (
    <Menu
      className={css.rowMenu}
      open
      portal
      autoFocus
      anchor={null}
      items={items}
      getAnchorRect={getAnchorRect}
      onSelect={onSelect}
      onClose={onClose}
    >
      {children}
    </Menu>
  )
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree, menu }: {
  parent: string
  entry: WorkspaceDirectoryEntry
  tree: TreeContext
  menu: RowMenu
}): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <button
          type="button"
          className={css.row}
          aria-expanded={expanded}
          onContextMenu={(event) => { menu.press({ path, parent, kind: 'directory', expanded }, event) }}
          onClick={() => { tree.onToggle(parent, path) }}
        >
          {expanded ? <IconFolderOpenRegular className={css.icon} /> : <IconFolderCloseRegular className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
        </button>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} menu={menu} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path}>
        <button
          type="button"
          className={clsx(css.row, tree.state.active === path && css.rowActive)}
          aria-current={tree.state.active === path ? 'true' : undefined}
          onContextMenu={(event) => { menu.press({ path, parent, kind: 'file', expanded: false }, event) }}
          onClick={() => { tree.onOpen(path) }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
          <span className={css.name}>{entry.name}</span>
        </button>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree, menu }: { path: string; tree: TreeContext; menu: RowMenu }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {level.failure !== undefined && <li className={css.note} data-files-row="failed">{failureLine(t, level.failure)}</li>}
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} menu={menu} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/**
 * The tree's scroller content: the workspace root and whatever the reader has
 * opened under it.
 * @param tree - the tab's tree, the shown file, and the gestures.
 * @returns the rows of the tree's one scroller.
 */
export function TreeList(tree: TreeContext): ReactNode {
  const [open, setOpen] = useState<OpenRowMenu | undefined>(undefined)
  const menu = useMemo((): RowMenu => ({
    open,
    press: (row, event) => {
      // The browser's own menu never replaces the tree's.
      event.preventDefault()
      if (open?.path === row.path) {
        setOpen(undefined)
        return
      }
      const box = event.currentTarget.getBoundingClientRect()
      // A keyboard press reports no point; the row's own box stands in, so the
      // menu lands beside the row instead of at the viewport's corner.
      setOpen({ ...row, rect: new DOMRect(event.clientX || box.left, event.clientY || box.bottom, 0, 0) })
    },
    dismiss: () => { setOpen(undefined) },
  }), [open])
  return (
    <>
      <ul className={css.level}><Level path={tree.state.root} tree={tree} menu={menu} /></ul>
      {open !== undefined && (
        <RowMenu
          rect={open.rect}
          items={open.kind === 'directory' ? directoryMenu(tree.t, open.expanded) : fileMenu(tree.t)}
          // The pick closes the menu before its arm runs, so a failure the arm
          // announces outlives it.
          onSelect={(id) => {
            menu.dismiss()
            if (open.kind === 'directory') pickDirectoryRow(id, open.parent, open.path, tree)
            else pickFileRow(id, open.path, tree)
          }}
          onClose={menu.dismiss}
        >
          {tree.renderMenuRow?.(open.path, menu.dismiss)}
        </RowMenu>
      )}
    </>
  )
}
