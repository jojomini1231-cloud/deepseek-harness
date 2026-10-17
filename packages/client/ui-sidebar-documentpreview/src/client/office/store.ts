/** Loaded Office previews survive body remounts until reload or view closure. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { blankRecord } from '../document/blank-record.ts'
import type { OfficeFileBytes } from './cache.ts'

/** One requested source revision and its settled preview. */
export interface OfficeView {
  readonly revision: number
  readonly file?: OfficeFileBytes
  readonly failure?: { readonly code: string; readonly message: string }
}

/** Office-owned content, isolated by view identity. */
export interface OfficeState {
  byView: Record<string, OfficeView>
}

type OfficeActions = {
  loading: (state: OfficeState, viewKey: string, revision: number) => void
  complete: (state: OfficeState, viewKey: string, revision: number, file: OfficeFileBytes) => void
  failed: (state: OfficeState, viewKey: string, revision: number, failure: NonNullable<OfficeView['failure']>) => void
  forget: (state: OfficeState, viewKey: string) => void
}

/**
 * Retain Office contents across body remounts within a Session.
 * @returns the view-content store declaration.
 */
export function createOfficeStore(): EngineStoreHandle<OfficeState, OfficeActions> {
  return defineStore({
    init: (): OfficeState => ({ byView: blankRecord() }),
    actions: {
      /** @param state - draft. @param viewKey - owning view. @param revision - new content revision. */
      loading(state, viewKey: string, revision: number) { state.byView[viewKey] = { revision } },
      /** @param state - draft. @param viewKey - owning view. @param revision - completed revision. @param file - borrowed PDF bytes. */
      complete(state, viewKey: string, revision: number, file: OfficeFileBytes) {
        state.byView[viewKey] = { revision, file }
      },
      /** @param state - draft. @param viewKey - owning view. @param revision - failed revision. @param failure - displayable failure. */
      failed(state, viewKey: string, revision: number, failure: NonNullable<OfficeView['failure']>) {
        state.byView[viewKey] = { revision, failure }
      },
      /** @param state - draft. @param viewKey - ended view. */
      forget(state, viewKey: string) {
        const remaining = blankRecord<OfficeView>()
        for (const [key, view] of Object.entries(state.byView)) {
          if (key !== viewKey) remaining[key] = view
        }
        state.byView = remaining
      },
    },
  })
}

/** Store declaration used by the Office body. */
export type OfficeStore = ReturnType<typeof createOfficeStore>
