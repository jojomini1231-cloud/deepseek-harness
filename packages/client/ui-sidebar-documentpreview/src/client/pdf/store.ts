/** Restorable PDF viewing preferences; document objects and canvases remain component-local. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { blankRecord } from '../document/blank-record.ts'
import type { ZoomPreference } from '../zoom/types.ts'

/** One view's last visible page and optional PDF zoom preference. */
export interface PdfView {
  readonly page: number
  readonly zoom?: ZoomPreference
}

/** Page state isolated by the owning view lifetime. */
export interface PdfState {
  byView: Record<string, PdfView>
}

type PdfActions = {
  page: (draft: PdfState, viewKey: string, page: number) => void
  zoom: (draft: PdfState, viewKey: string, zoom: ZoomPreference) => void
  forget: (draft: PdfState, viewKey: string) => void
}

/**
 * Declare the last visible page and zoom preference isolated by view identity.
 * @returns a store declaration instantiated by the document slot for each Session.
 */
export function createPdfStore(): EngineStoreHandle<PdfState, PdfActions> {
  return defineStore({
    init: (): PdfState => ({ byView: blankRecord() }),
    actions: {
      /** @param draft - view state. @param viewKey - owning view. @param page - selected 1-based page. */
      page: (draft, viewKey: string, page: number) => {
        draft.byView[viewKey] = { ...draft.byView[viewKey], page }
      },
      /** @param draft - view state. @param viewKey - owning view. @param zoom - selected scale multiplier. */
      zoom: (draft, viewKey: string, zoom: ZoomPreference) => {
        draft.byView[viewKey] = { page: draft.byView[viewKey]?.page ?? 1, zoom }
      },
      /** @param draft - view state. @param viewKey - ended view whose preferences are discarded. */
      forget: (draft, viewKey: string) => {
        const remaining = blankRecord<PdfView>()
        for (const [id, view] of Object.entries(draft.byView)) {
          if (id !== viewKey) remaining[id] = view
        }
        draft.byView = remaining
      },
    },
  })
}

/** Store declaration used by the PDF body registration. */
export type PdfStore = ReturnType<typeof createPdfStore>
