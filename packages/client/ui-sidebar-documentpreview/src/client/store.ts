/**
 * The preview's own state: the pages it has read, and how the reader views them.
 *
 * The `file` resource carries metadata only, so the text is this type's to fetch
 * and keep — page by page, keyed by the 1-based line each page starts at. The
 * view state (scroll offset, wrap, the navigation already answered) must outlive
 * the body: a tab switched away from unmounts its body and must come back where
 * it was rather than re-read or jump to its opening line again. Bucketed by the
 * host's view key because two views of one file scroll independently.
 *
 * A bucket lives as long as its view's lifetime: the face's first read of a
 * view arms one listener on the owner's `signal` that forgets the bucket when
 * that lifetime ends, and a view that never read has no bucket to forget.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DocumentFileBytes } from './rpc.ts'
import type { DocumentLoadMode } from './document/registry.ts'
import { blankRecord } from './document/blank-record.ts'

/**
 * One page as the store keeps it: its text and the Host's line count, which
 * tells a page past the file's last line (`lines: 0`) from a page holding one
 * empty line (`lines: 1`, `text: ''`).
 */
export interface TextPage {
  readonly text: string
  readonly lines: number
}

/** One tab's pages and view. */
export interface TextTabState {
  autoRefresh: boolean
  resourcesDirty: boolean
  /** Explicit viewer choice for this tab; absence follows automatic matching. */
  rendererId?: string
  /** Current display-loading mode; absent before the first read. */
  mode?: DocumentLoadMode
  /** Implementation owning source loading; absent for ordinary file reads. */
  contentRendererId?: string
  /** Current content revision, incremented whenever loaded content is discarded. */
  loadRevision: number
  /** Full byte result used by complete-file renderers. */
  complete?: DocumentFileBytes
  /** The file version the loaded pages belong to; absent before the first page. */
  version: string | undefined
  /** Metadata version observed when this tab began its current read generation. */
  observedVersion: string | undefined
  /** Pages by the 1-based line each starts at. */
  pages: Record<number, TextPage>
  /** Whether the last loaded page reached the end of the file. */
  eof: boolean
  /** A page read is in flight. */
  loading: boolean
  /** Why the last page read failed; cleared by the next page. */
  failure: RemoteFailure | undefined
  /** Scroll offset of the body, in px. */
  scrollTop: number
  /** Whether long lines wrap instead of scrolling horizontally; on until the reader turns it off. */
  wrap: boolean
  /** The `navigation.revision` the body already answered; absent before the first. */
  revision: number | undefined
}

/** Every view's state, keyed by the host's identity for the view. */
export interface TextState {
  byView: Record<string, TextTabState>
}

/**
 * A tab's state before it reads, scrolls, toggles, or answers anything.
 * @returns the empty bucket.
 */
export function fresh(): TextTabState {
  return {
    autoRefresh: true,
    resourcesDirty: false,
    loadRevision: 0,
    version: undefined,
    observedVersion: undefined,
    pages: {},
    eof: false,
    loading: false,
    failure: undefined,
    scrollTop: 0,
    wrap: true,
    revision: undefined,
  }
}

/** The bucket for one view, created on first write. */
function bucket(state: TextState, viewKey: string): TextTabState {
  return state.byView[viewKey] ??= fresh()
}

/** The preview store's write set; every action names the tab it writes. */
type TextActions = {
  toggledAutoRefresh: (draft: TextState, viewKey: string) => void
  resourceChanged: (draft: TextState, viewKey: string) => void
  selected: (draft: TextState, viewKey: string, rendererId: string | undefined) => void
  loading: (draft: TextState, viewKey: string, mode?: DocumentLoadMode, observedVersion?: string, contentRendererId?: string) => void
  rendered: (draft: TextState, viewKey: string, revision: number, version: string) => void
  rendererFailed: (draft: TextState, viewKey: string, revision: number) => void
  complete: (draft: TextState, viewKey: string, file: DocumentFileBytes) => void
  page: (draft: TextState, viewKey: string, page: WorkspaceFileText) => void
  failed: (draft: TextState, viewKey: string, failure: RemoteFailure) => void
  reset: (draft: TextState, viewKey: string) => void
  scrolled: (draft: TextState, viewKey: string, scrollTop: number) => void
  toggledWrap: (draft: TextState, viewKey: string) => void
  navigated: (draft: TextState, viewKey: string, revision: number) => void
  forget: (draft: TextState, viewKey: string) => void
}

/**
 * Declare the preview's store.
 *
 * Constructed once in apply and shared by the body and the tools registrations,
 * which the slot runtime allows because both are session-scoped.
 * @returns the store handle to declare on both registrations.
 */
export function createTextStore(): EngineStoreHandle<TextState, TextActions> {
  return defineStore({
    init: (): TextState => ({ byView: blankRecord() }),
    actions: {
      toggledAutoRefresh: (d, viewKey: string) => {
        const state = bucket(d, viewKey)
        state.autoRefresh = !state.autoRefresh
      },
      resourceChanged: (d, viewKey: string) => { bucket(d, viewKey).resourcesDirty = true },
      /** @param d - draft. @param viewKey - owning tab. @param rendererId - manual choice, or automatic selection. */
      selected: (d, viewKey: string, rendererId: string | undefined) => {
        if (rendererId === undefined) delete bucket(d, viewKey).rendererId
        else bucket(d, viewKey).rendererId = rendererId
      },
      /**
       * Mark a page read as in flight.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       * @param mode - selected renderer's loading mode.
       * @param observedVersion - metadata version at read start; later pages retain the initial observation.
       * @param contentRendererId - implementation owning source loading.
       */
      loading: (d, viewKey: string, mode?: DocumentLoadMode, observedVersion?: string, contentRendererId?: string) => {
        const state = bucket(d, viewKey)
        if (state.version === undefined && !state.loading) state.observedVersion = observedVersion
        if (contentRendererId === undefined) delete state.contentRendererId
        else state.contentRendererId = contentRendererId
        state.loading = true
        state.failure = undefined
        if (mode !== undefined) state.mode = mode
      },
      /**
       * @param d - draft. @param viewKey - owning tab.
       * @param revision - active content revision. @param version - displayed source version.
       */
      rendered: (d, viewKey: string, revision: number, version: string) => {
        const state = d.byView[viewKey]
        if (state?.mode !== 'renderer' || state.loadRevision !== revision) return
        state.version = version
        state.loading = false
      },
      /** @param d - draft. @param viewKey - owning tab. @param revision - failed content revision. */
      rendererFailed: (d, viewKey: string, revision: number) => {
        const state = d.byView[viewKey]
        if (state?.mode !== 'renderer' || state.loadRevision !== revision) return
        state.loading = false
      },
      /** @param d - draft. @param viewKey - owning tab. @param file - complete byte result for this view. */
      complete: (d, viewKey: string, file: DocumentFileBytes) => {
        const state = bucket(d, viewKey)
        state.complete = file
        state.version = file.version
        state.eof = true
        state.loading = false
        state.failure = undefined
      },
      /**
       * Keep one page. A page from a newer file version invalidates the pages
       * of the older one, so the body never shows two versions at once.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       * @param page - the page the Host returned.
       */
      page: (d, viewKey: string, page: WorkspaceFileText) => {
        const state = bucket(d, viewKey)
        if (state.version !== undefined && state.version !== page.version) state.pages = {}
        state.version = page.version
        state.pages[page.offset] = { text: page.text, lines: page.lines }
        state.eof = page.eof
        state.loading = false
        state.failure = undefined
      },
      /**
       * Record why a page read failed; the pages already held stay.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, viewKey: string, failure: RemoteFailure) => {
        const state = bucket(d, viewKey)
        state.loading = false
        state.failure = failure
      },
      /**
       * Drop every page, keeping the view, for a re-read from the first line.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       */
      reset: (d, viewKey: string) => {
        const state = bucket(d, viewKey)
        state.resourcesDirty = false
        state.loadRevision++
        state.pages = {}
        delete state.complete
        state.eof = false
        state.version = undefined
        state.observedVersion = undefined
        state.loading = false
        state.failure = undefined
      },
      /**
       * Record where one tab's body is scrolled to.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       * @param scrollTop - the body's scroll offset, in px.
       */
      scrolled: (d, viewKey: string, scrollTop: number) => {
        bucket(d, viewKey).scrollTop = scrollTop
      },
      /**
       * Switch one tab between wrapped and unwrapped lines.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       */
      toggledWrap: (d, viewKey: string) => {
        const state = bucket(d, viewKey)
        state.wrap = !state.wrap
      },
      /**
       * Record that the body answered one navigation, so a remount restores the
       * reader's position instead of jumping again.
       * @param d - draft state.
       * @param viewKey - the tab being drawn.
       * @param revision - the `navigation.revision` answered.
       */
      navigated: (d, viewKey: string, revision: number) => {
        bucket(d, viewKey).revision = revision
      },
      /**
       * Drop one view's state, for a view lifetime that ended.
       * @param d - draft state.
       * @param viewKey - the view that went away.
       */
      forget: (d, viewKey: string) => {
        const byView = blankRecord<TextTabState>()
        for (const [key, state] of Object.entries(d.byView)) {
          if (key !== viewKey) byView[key] = state
        }
        d.byView = byView
      },
    },
  })
}

/** The store handle type both registrations declare. */
export type TextStore = ReturnType<typeof createTextStore>
