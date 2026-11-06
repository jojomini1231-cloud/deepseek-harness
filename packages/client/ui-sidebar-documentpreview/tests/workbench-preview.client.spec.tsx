/**
 * The Files workbench's preview seat filler: the reusable preview over the
 * chip's file, with the seat's inputs and no tab information.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PaneId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkbenchPreview } from '../src/client/WorkbenchPreview.tsx'
import { ADDRESS } from './fixtures.client.ts'

describe('WorkbenchPreview', () => {
  it('renders the reusable preview with the seat\'s address, view key, navigation, chip lifetime, and pane, and no tab information', () => {
    const drawn = <div data-preview />
    const renderFactorySlot = vi.fn<RenderFactorySlot>(() => drawn)
    const chip = new AbortController()
    const navigation = { address: ADDRESS, params: undefined, revision: 1 }
    const out = WorkbenchPreview({
      address: ADDRESS, viewKey: `tab-1:${ADDRESS}`, navigation, signal: chip.signal,
      paneId: 'pane-1' as PaneId, renderFactorySlot,
    })
    expect(out).toBe(drawn)
    expect(renderFactorySlot).toHaveBeenCalledExactlyOnceWith('sidebar.document.preview', {
      address: ADDRESS, viewKey: `tab-1:${ADDRESS}`, navigation, signal: chip.signal, paneId: 'pane-1',
    })
  })
})
