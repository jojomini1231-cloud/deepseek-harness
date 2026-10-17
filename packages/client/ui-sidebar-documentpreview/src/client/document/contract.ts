/** Document renderer slot: the view supplies shared file state, renderers own their presentation. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime, SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabNavigation } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { RefCallback } from 'react'
import type { TextInjected } from '../face.ts'
import type { TextStore } from '../store.ts'
import type { DocumentPreviewDefinition } from './registry.ts'

/** One loaded text window, retaining source line positions. */
export interface DocumentTextPage {
  readonly offset: number
  readonly text: string
  readonly lines: number
}

/**
 * Ordinary file contents, or a request for the selected renderer to load its content.
 * Byte arrays are transient UI input, never persisted layout or Session data.
 */
export type DocumentContent =
  | { readonly kind: 'text'; readonly text: string; readonly pages: readonly DocumentTextPage[]; readonly eof: boolean }
  | { readonly kind: 'bytes'; readonly data: Uint8Array<ArrayBuffer> }
  | {
    readonly kind: 'renderer'
    /** Changes on reload or implementation replacement; retained contents belong to one revision. */
    readonly revision: number
    /** Report the displayed source version; stale revisions cannot update the owner. @param version - loaded source version. */
    readonly loaded: (version: string) => void
    /** End a failed load; a later file change can start another revision. */
    readonly failed: () => void
    /** Cancel the current load and start a new revision. */
    readonly reload: () => void
  }

/** Content and viewing inputs shared by document bodies and nested PDF presentation. */
export interface DocumentBodyOwner {
  /** Observe a file read by this renderer. @param address - complete file resource address. */
  readonly addResource: (address: string) => void
  /** Replace this renderer's dependencies. @param addresses - complete file resource addresses. */
  readonly setResources: (addresses: readonly string[]) => void
  /** Original file address, also readable through the standard useResource hook. */
  readonly resourceAddress: string
  /** Ordinary file content or a renderer-owned loading request; text accumulates until eof. */
  readonly content: DocumentContent
  /** The document toolbar's current wrapping preference. */
  readonly wrap: boolean
  /** Report a renderer-owned scrollport; passing `null` restores the shared body as the owner. */
  readonly scrollportRef: RefCallback<HTMLElement>
}

/**
 * One rendered document view, independent of the host that renders it: a
 * Sidebar tab, or a preview inside another body.
 */
export interface DocumentView {
  /**
   * Identity the renderer buckets its own view state by: one per shown
   * document, so two hosts showing one file keep their scroll and zoom apart,
   * and one host showing two files keeps them apart as well.
   */
  readonly viewKey: string
  /** Navigation that opened or last re-aimed this view; its params drive source navigation. */
  readonly navigation: SidebarRightTabNavigation
  /** Aborted when this view ends: loads cancel and released buckets are forgotten with it. */
  readonly signal: AbortSignal
}

/**
 * Read the enclosing document view.
 * @returns the view's identity, navigation, and lifetime.
 */
export type UseDocumentView = () => DocumentView

/**
 * What one reusable preview needs from its host.
 *
 * The host owns the address and the view's lifetime; the preview owns reading,
 * renderer selection, the toolbar, and the renderer slots, so a host renders a
 * document without knowing how any format is drawn.
 */
export interface DocumentPreviewInput {
  /** Resource address of the file to show. */
  readonly address: string
  /** Bucket key for view state; see {@link DocumentView.viewKey}. */
  readonly viewKey: string
  /** Navigation that opened or last re-aimed this view. */
  readonly navigation: SidebarRightTabNavigation
  /** View lifetime; loads cancel and released buckets are forgotten with it. */
  readonly signal: AbortSignal
  /** Bind the host's refresh command to this preview; omitted when the host has none. */
  readonly bindRefresh?: (commands: { readonly refresh?: () => void }) => () => void
  /** Effective refresh binding the toolbar's reload control advertises; omitted shows no keys. */
  readonly refreshShortcut?: ShortcutCatalogEntry | undefined
}

/** The reusable preview's inject face: the business reads plus the renderer registry source. */
export interface DocumentPreviewInjected extends TextInjected {
  readonly hooks: { readonly documentPreviews: ObservableSnapshot<readonly DocumentPreviewDefinition[]> }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Document body selected by a registered implementation id. */
    'sidebar.right.tab.document': {
      kind: 'keyed'
      scope: 'session'
      owner: DocumentBodyOwner
      hookContext: UseDocumentView
      inject: {
        hooks: {
          documentView: SlotHookFactory<'sidebar.right.tab.document', UseDocumentView>
        }
      }
    }
    /**
     * Header toolbar contributions acting on the previewed file, rendered
     * after the preview's own controls once the file's Host path is known.
     */
    'sidebar.right.tab.document.actions': {
      kind: 'list'
      scope: 'session'
      owner: {
        /** Absolute path in the file's execution environment; native actions must verify a Host mapping. */
        readonly absolutePath: string
      }
    }
    /**
     * Empty-state contributions for a file this preview cannot render,
     * offered where Retry would stand once the file's Host path is known.
     */
    'sidebar.right.tab.document.unpreviewable': {
      kind: 'list'
      scope: 'session'
      owner: {
        /** Absolute path in the file's execution environment; native actions must verify a Host mapping. */
        readonly absolutePath: string
      }
    }
    /** Renderer-specific controls before the document toolbar's reload button. */
    'sidebar.right.tab.document.action': {
      kind: 'keyed'
      scope: 'session'
      owner: { readonly content: DocumentContent }
      hookContext: UseDocumentView
      inject: { hooks: { documentView: SlotHookFactory<'sidebar.right.tab.document', UseDocumentView> } }
    }
  }

  interface SlotFactoryMap {
    /**
     * Reusable file preview: one document view with the shared toolbar and the
     * registered renderers, rendered by any host that can name an address.
     */
    'sidebar.document.preview': {
      scope: 'session'
      props: DocumentPreviewInput
      store: TextStore
      locale: 'sidebarDocumentPreview'
      inject: DocumentPreviewInjected
      children: {
        'sidebar.right.tab.document': {
          kind: 'keyed'
          scope: 'session'
          inject: { hooks: { documentView: SlotHookFactory<'sidebar.right.tab.document', UseDocumentView> } }
        }
        'sidebar.right.tab.document.action': {
          kind: 'keyed'
          scope: 'session'
          inject: { hooks: { documentView: SlotHookFactory<'sidebar.right.tab.document', UseDocumentView> } }
        }
        'sidebar.right.tab.document.actions': { kind: 'list'; scope: 'session' }
        'sidebar.right.tab.document.unpreviewable': { kind: 'list'; scope: 'session' }
      }
    }
  }
}

/** Standard input for every document body; entry-local stores and locale props can be intersected with it. */
export type DocumentPreviewProps = PropsRuntime<'sidebar.right.tab.document'>

/**
 * Forward the framework's document-view reader to the selected document body.
 * @param _standard - framework standard props.
 * @param useDocumentView - enclosing view's bound reader.
 * @returns the same reader, without another subscription adapter.
 */
export const documentViewFactory: SlotHookFactory<'sidebar.right.tab.document', UseDocumentView> =
  (_standard, useDocumentView) => useDocumentView
