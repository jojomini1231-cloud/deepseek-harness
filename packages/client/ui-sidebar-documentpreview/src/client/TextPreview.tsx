/**
 * The `text` tab type's body: one document view over the tab's address.
 *
 * The tab owns only what is tab-specific — its address, its record identity,
 * its navigation, its lifetime, and the Sidebar's refresh command. Everything
 * the reader sees comes from the reusable `sidebar.document.preview` Factory,
 * which the Files workbench renders the same way for a file it shows in place.
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
  const { tab } = useTabInfo()
  return renderFactorySlot('sidebar.document.preview', {
    address: tab.contentId,
    viewKey: tab.id,
    navigation: tab.navigation,
    signal: tab.signal,
    bindRefresh: commands => tab.actions.bindCommands(commands),
    refreshShortcut: tab.refreshShortcut,
  })
}

export { linesOf, loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
export type { LoadedPage } from './text/lines.ts'
