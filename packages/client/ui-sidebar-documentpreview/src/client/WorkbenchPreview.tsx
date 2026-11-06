/**
 * The Files workbench's preview: the reusable `sidebar.document.preview`
 * Factory over the file an open chip shows.
 *
 * ui-sidebar-files declares the single `sidebar.right.tab.files.preview` seat
 * and renders it in the content column; this filler hands the seat's address,
 * view key, navigation, chip lifetime, and pane to the Factory unchanged. It
 * passes no `useTabInfo`, because the workbench draws its own navigator beside
 * the preview.
 */
import type { ReactNode } from 'react'
import type { OwnerOf, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type {} from './document/contract.ts'

/** The filler's inputs: the seat's owner props and the Factory renderer. */
export type WorkbenchPreviewProps =
  & OwnerOf<'sidebar.right.tab.files.preview'>
  & PropsRenderFactories

/**
 * Render the shown file through the reusable preview.
 * @param props - the chip's file, view key, navigation, lifetime, pane, and the Factory renderer.
 * @returns the document view for the chip's file.
 */
export function WorkbenchPreview({ address, viewKey, navigation, signal, paneId, renderFactorySlot }: WorkbenchPreviewProps): ReactNode {
  return renderFactorySlot('sidebar.document.preview', { address, viewKey, navigation, signal, paneId })
}
