/** View-local zoom preferences for renderers without additional view state. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { blankRecord } from '../document/blank-record.ts'
import { FIT_WIDTH, type ZoomPreference } from './types.ts'

/** View-lifetime callback supplied by a zoomable renderer registration. */
export interface ZoomInjected {
  /** @param viewKey - owning view. @param signal - complete view lifetime. */
  readonly retainView: (viewKey: string, signal: AbortSignal) => void
}

/** Zoom state isolated by the owning view lifetime. */
export interface ZoomState {
  byView: Record<string, ZoomPreference>
}

type ZoomActions = {
  zoom: (draft: ZoomState, viewKey: string, preference: ZoomPreference) => void
  forget: (draft: ZoomState, viewKey: string) => void
}

/**
 * Create view-local zoom state for a document renderer registration.
 * @returns a store declaration retaining zoom until its view ends.
 */
export function createZoomStore(): EngineStoreHandle<ZoomState, ZoomActions> {
  return defineStore({
    init: (): ZoomState => ({ byView: blankRecord() }),
    actions: {
      zoom: (draft, viewKey: string, preference: ZoomPreference) => { draft.byView[viewKey] = preference },
      forget: (draft, viewKey: string) => {
        const remaining = blankRecord<ZoomPreference>()
        for (const [key, preference] of Object.entries(draft.byView)) {
          if (key !== viewKey) remaining[key] = preference
        }
        draft.byView = remaining
      },
    },
  })
}

/** Default zoom value for a tab without retained state. */
export const DEFAULT_ZOOM = FIT_WIDTH

/** Store declaration used by image previews. */
export type ZoomStore = ReturnType<typeof createZoomStore>
