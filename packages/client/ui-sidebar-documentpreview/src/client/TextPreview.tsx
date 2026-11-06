/**
 * The `text` tab type's body: one document view over the tab's address.
 *
 * The tab owns only what is tab-specific — its address, its record identity,
 * its navigation, its lifetime, its pane, and the Sidebar's refresh command.
 * Everything the reader sees comes from the reusable `sidebar.document.preview`
 * Factory, which `WorkbenchPreview` also renders, through the Files workbench's
 * preview seat, for a file the workbench shows in place. The tab also hands
 * over its own information hook, so the preview draws the workspace navigator
 * beside the document and a file chosen there replaces this tab.
 */
import type { ReactNode } from 'react'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './document/contract.ts'

/** The body's composed props: the tab and the reusable preview Factory. */
export type TextPreviewProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderFactories

/**
 * The text type's body, registered under `sidebar.right.pane.tab` as `text`.
 * @param props - the tab's reader and the Factory renderer.
 * @returns the tab's document view.
 */
export function TextPreview({ useTabInfo, renderFactorySlot }: TextPreviewProps): ReactNode {
  const { tab, panel } = useTabInfo()
  return renderFactorySlot('sidebar.document.preview', {
    address: tab.contentId,
    viewKey: tab.id,
    navigation: tab.navigation,
    signal: tab.signal,
    bindRefresh: commands => tab.actions.bindCommands(commands),
    refreshShortcut: tab.refreshShortcut,
    paneId: panel.id,
    useTabInfo,
  })
}

export { linesOf, loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
export type { LoadedPage } from './text/lines.ts'
