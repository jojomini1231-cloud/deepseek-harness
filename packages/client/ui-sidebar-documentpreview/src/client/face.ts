/**
 * The preview's asynchronous half: reading pages into the store.
 *
 * The component never awaits anything. It asks for a page and this face performs
 * the read and writes the outcome through the store's own actions — the
 * Slot-standard `inject` form, so the write set stays the store's. The session
 * the read runs under comes from the file's address, not from the slot's
 * session: the address is the read's whole authority.
 *
 * A view's pages are one file version walked from the first line. Dropping them
 * — a reload, or a page of a newer version arriving past the first line, which
 * restarts the walk — retires every read still in flight for the view: a
 * settlement from before the drop writes nothing. Cleanup rides the owner's
 * `signal`, armed once per view by its first read: the abort forgets the view's
 * bucket and this bookkeeping, a request is not made for a lifetime that already
 * ended, and a settlement arriving after it is gone has nothing left to
 * write to. A view that never read has no bucket to forget.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReadDocumentBytes, ReadWorkspaceFilePage, SessionFile } from './rpc.ts'
import type { TextStore } from './store.ts'
import type { DocumentLoadMode } from './document/registry.ts'
import type { Resources } from '@deepseek-ai/dsh-client-resources/client'
import { ResourceGroup } from './document/resource-group.ts'

/** The preview's injected business face, as the body receives it. */
export interface TextInjected {
  /** Observe one renderer dependency. @param viewKey - owning view. @param address - resource address. @param signal - view lifetime. */
  readonly addResource: (viewKey: string, address: string, signal: AbortSignal) => void
  /** Replace dependency membership. @param viewKey - owning view. @param addresses - resource addresses. @param signal - view lifetime. */
  readonly setResources: (viewKey: string, addresses: readonly string[], signal: AbortSignal) => void
  /**
   * Read one page into the store. A page of a newer file version than the pages
   * held, arriving past the first line, is not kept: the view's pages are dropped
   * and the first page read again. The view's first read arms the abort listener
   * that forgets its bucket when its lifetime ends.
   * @param viewKey - the view being drawn.
   * @param file - the session and workspace path the view's address names.
   * @param offset - 1-based line the page starts at.
   * @param signal - the view's lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly loadPage: (viewKey: string, file: SessionFile, offset: number, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Drop every page and read the first one again, for a file the Host reports
   * changed. The view is kept, so the reader stays where they were; a page read
   * still in flight writes nothing when it settles.
   * @param viewKey - the view being drawn.
   * @param file - the session and workspace path the view's address names.
   * @param signal - the view's lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly reloadPages: (viewKey: string, file: SessionFile, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Read the complete file for a whole-file renderer.
   * @param viewKey - owning view.
   * @param file - the session and workspace path the view's address names.
   * @param signal - view lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly loadAll: (
    viewKey: string, file: SessionFile, signal: AbortSignal, observedVersion?: string,
  ) => void
  /**
   * Discard the old complete result and read again.
   * @param viewKey - owning view.
   * @param file - the session and workspace path the view's address names.
   * @param signal - view lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly reloadAll: (
    viewKey: string, file: SessionFile, signal: AbortSignal, observedVersion?: string,
  ) => void
  /**
   * Begin a renderer-owned load without reading source bytes.
   * @param viewKey - owning view.
   * @param signal - view lifetime.
   * @param rendererId - selected implementation.
   * @param observedVersion - metadata version observed at request start.
   * @param reload - discard the previous content revision.
   */
  readonly prepareRenderer: (viewKey: string, signal: AbortSignal, rendererId: string, observedVersion?: string, reload?: boolean) => void
}

/**
 * What the face remembers of one view: the read generation a settlement must
 * match, and the version of the pages held. Created by the view's first read,
 * which also arms the one abort listener that forgets the view.
 */
interface ViewReads {
  group: ResourceGroup
  generation: number
  version: string | undefined
  mode: DocumentLoadMode
  rendererId?: string
  controller?: AbortController
}

/**
 * Bind the preview's face to one paged read and one complete-byte read.
 * @param read - the bound `workspaceFiles.read` call.
 * @param readAll - complete-byte workspace Remote read.
 * @param resources - shared metadata sources for the document and its dependencies.
 * @returns the Slot `inject` factory: bound actions in, face out. The slot's session id is unused because the address carries its own.
 */
export function textFace(
  read: ReadWorkspaceFilePage,
  readAll: ReadDocumentBytes,
  resources: Resources,
): (sessionId: SessionId, actions: BoundActions<TextStore>) => TextInjected {
  return (_sessionId: SessionId, actions: BoundActions<TextStore>): TextInjected => {
    const views = new Map<string, ViewReads>()
    // Reached with a live signal only: the lifetime's end forgets the view's
    // bucket and this bookkeeping in one listener, however often its body mounts.
    const readsOf = (viewKey: string, signal: AbortSignal): ViewReads => {
      const held = views.get(viewKey)
      if (held !== undefined) return held
      const created: ViewReads = {
        generation: 0, version: undefined, mode: 'text-pages',
        group: new ResourceGroup(resources, () => { actions.resourceChanged(viewKey) }),
      }
      views.set(viewKey, created)
      signal.addEventListener('abort', () => {
        created.controller?.abort()
        created.group.close()
        views.delete(viewKey)
        actions.forget(viewKey)
      }, { once: true })
      return created
    }
    const modeOf = (viewKey: string, signal: AbortSignal, mode: DocumentLoadMode, rendererId?: string): ViewReads => {
      const reads = readsOf(viewKey, signal)
      if (reads.mode !== mode || reads.rendererId !== rendererId) {
        reads.controller?.abort()
        if (rendererId === undefined) delete reads.rendererId
        else reads.rendererId = rendererId
        reads.mode = mode
        reads.generation++
        reads.version = undefined
        actions.reset(viewKey)
      }
      return reads
    }
    const loadPage = (viewKey: string, file: SessionFile, offset: number, signal: AbortSignal, observedVersion?: string): void => {
      if (signal.aborted) return
      const reads = modeOf(viewKey, signal, 'text-pages')
      const { generation } = reads
      actions.loading(viewKey, 'text-pages', observedVersion)
      void read(file.sessionId, file.path, offset, signal).then((result) => {
        if (signal.aborted || reads.generation !== generation) return
        if (!result.ok) {
          actions.failed(viewKey, result.error)
          return
        }
        // Pages of two versions never meet: a newer file past the first line
        // restarts the walk from line 1, where the store adopts the new version.
        if (offset !== 1 && reads.version !== undefined && result.value.version !== reads.version) {
          restart(viewKey, file, signal, observedVersion)
          return
        }
        reads.version = result.value.version
        actions.page(viewKey, result.value)
      })
    }
    const loadAll = (
      viewKey: string, file: SessionFile, signal: AbortSignal, observedVersion?: string,
    ): void => {
      if (signal.aborted) return
      const reads = modeOf(viewKey, signal, 'bytes-complete')
      reads.controller?.abort()
      const controller = new AbortController()
      reads.controller = controller
      const lifetime = AbortSignal.any([signal, controller.signal])
      actions.loading(viewKey, 'bytes-complete', observedVersion)
      void readAll(file, lifetime).then((result) => {
        if (lifetime.aborted) return
        if (!result.ok) {
          actions.failed(viewKey, result.error)
          return
        }
        const file = result.value
        reads.version = file.version
        actions.complete(viewKey, file)
      }, (error: unknown) => {
        if (lifetime.aborted) return
        actions.failed(viewKey, Object.assign(
          new Error(error instanceof Error ? error.message : String(error), { cause: error }),
          { name: 'RemoteError', isDSHRemoteError: true as const, code: 'gateway/internal' as const, details: {} },
        ))
      })
    }
    const restart = (
      viewKey: string, file: SessionFile, signal: AbortSignal, observedVersion?: string, mode: DocumentLoadMode = 'text-pages',
    ): void => {
      if (signal.aborted) return
      const reads = readsOf(viewKey, signal)
      reads.controller?.abort()
      reads.generation += 1
      reads.version = undefined
      actions.reset(viewKey)
      if (mode === 'text-pages') loadPage(viewKey, file, 1, signal, observedVersion)
      else loadAll(viewKey, file, signal, observedVersion)
    }
    return {
      addResource: (viewKey, address, signal) => {
        if (!signal.aborted) readsOf(viewKey, signal).group.add(address)
      },
      setResources: (viewKey, addresses, signal) => {
        if (!signal.aborted) readsOf(viewKey, signal).group.set(addresses)
      },
      loadPage, reloadPages: restart, loadAll,
      prepareRenderer: (viewKey, signal, rendererId, observedVersion, reload = false) => {
        if (signal.aborted) return
        modeOf(viewKey, signal, 'renderer', rendererId)
        if (reload) actions.reset(viewKey)
        actions.loading(viewKey, 'renderer', observedVersion, rendererId)
      },
      reloadAll: (viewKey, file, signal, observedVersion) => { restart(viewKey, file, signal, observedVersion, 'bytes-complete') },
    }
  }
}
