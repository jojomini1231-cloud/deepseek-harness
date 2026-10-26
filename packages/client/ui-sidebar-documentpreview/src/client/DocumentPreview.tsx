/**
 * The reusable document preview: a file's content, or the reason it is not showing.
 *
 * Two sources meet here. The standard `useResource` hook gives the file's
 * metadata — its version — and this preview's own store holds the content it
 * read through its face. Metadata changes reload the current preview while
 * automatic refresh is enabled. A failed metadata frame — the file gone, its
 * workspace unknown — takes the same bar's place over the pages already loaded,
 * with the same reload. Its controls, viewer choice, wrap, and reload sit at the
 * end of the path row; the host supplies the address, the view identity, and the
 * view's lifetime, and knows none of this.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  FileTypeIcon, IconNowrapFillRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, IconWrapFillRegular, Menu, PathLabel, Tooltip, classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import { emptyFailureRecourse, failureLine } from './failure-line.ts'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { hostFileOf } from './rpc.ts'
import type { DocumentContent, DocumentView } from './document/contract.ts'
import { binaryDocumentPath, matchingDocumentPreviews } from './document/registry.ts'
import { unviewableBinaryPath } from './document/unviewable.ts'
import { PLAIN_BODY_ID } from './text/index.ts'
import { clearLineMark, loadedPages, lastLineLoaded, markLine, scrollToLine } from './text/lines.ts'
import css from './TextPreview.module.css'

/** The preview Factory's complete props: the host's view input plus the framework's shares. */
export type DocumentPreviewFactoryProps = FactoryComponentPropsOf<'sidebar.document.preview'>

/**
 * One document view: the file's content with the shared toolbar, or the reason
 * it is not showing.
 * @param props - the host's view input and the framework's shares.
 * @returns the content read so far with its controls, or a progress line.
 */
export function DocumentPreview({
  address, viewKey, navigation, signal, bindRefresh, refreshShortcut,
  useResource, useStore, actions, loadPage, reloadPages,
  loadAll, reloadAll, prepareRenderer, useDocumentPreviews, renderSlot, t,
  addResource, setResources,
}: DocumentPreviewFactoryProps): ReactNode {
  const meta = useResource<'file'>(address)
  const canRead = meta.status !== 'none'
  const file = useMemo(() => hostFileOf(address), [address])
  const state = useStore(s => s.byView[viewKey])
  // The renderer slots read the view, not the host: one stable object per view.
  const view = useMemo((): DocumentView => ({ viewKey, navigation, signal }), [viewKey, navigation, signal])
  const useDocumentView = useCallback(() => view, [view])
  const definitions = useDocumentPreviews(value => value)
  const unviewable = useMemo(() => unviewableBinaryPath(file.path), [file.path])
  const candidates = useMemo(() => {
    const matched = matchingDocumentPreviews(definitions, file.path)
    if (matched.length > 0 && binaryDocumentPath(definitions, file.path)) return matched
    if (matched.length === 0 && unviewable) return matched
    const fallback = definitions.find(definition => definition.id === PLAIN_BODY_ID)
    return fallback === undefined ? matched : [...matched, fallback]
  }, [definitions, file.path, unviewable])
  const selected = candidates.find(candidate => candidate.id === state?.rendererId) ?? candidates[0]
  const mode = selected?.loading
  const contentRendererId = mode === 'renderer' ? selected?.id : undefined
  const current = (state?.mode ?? 'text-pages') === mode && state?.contentRendererId === contentRendererId ? state : undefined
  const add = useCallback((address: string) => {
    addResource(viewKey, address, signal)
  }, [addResource, viewKey, signal])
  const set = useCallback((addresses: readonly string[]) => {
    setResources(viewKey, [address, ...addresses], signal)
  }, [setResources, viewKey, address, signal])
  useEffect(() => {
    set([])
  }, [set, selected?.id])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollportRef = useRef<HTMLElement | null>(null)
  const storedScrollTopRef = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const absolutePath = meta.value?.absolutePath ?? current?.complete?.absolutePath
  const displayPath = absolutePath ?? file.path
  // Contributions that hand the file to the Host wait for its Host path.
  const fileOwner = absolutePath === undefined ? undefined : { absolutePath }
  // Every tab of this type is a `file` resource address, so its params are the
  // `file` type's; the union is narrowed on the one field read, not validated.
  const line = navigation.params !== undefined && 'line' in navigation.params ? navigation.params.line : undefined
  const pages = current?.pages
  const loaded = useMemo(() => loadedPages(pages ?? {}), [pages])
  const loadedThrough = lastLineLoaded(loaded)
  const hasContent = mode === 'renderer' ? current?.version !== undefined : loaded.length > 0 || current?.complete !== undefined
  storedScrollTopRef.current = state?.scrollTop ?? 0
  const bindBody = useCallback((body: HTMLDivElement | null): void => {
    const previous = bodyRef.current
    bodyRef.current = body
    if (scrollportRef.current === null || scrollportRef.current === previous) scrollportRef.current = body
  }, [])
  const bindScrollport = useCallback((scrollport: HTMLElement | null): void => {
    const next = scrollport ?? bodyRef.current
    scrollportRef.current = next
    if (next !== null) next.scrollTop = storedScrollTopRef.current
  }, [])

  // First mount reads the first page; a body coming back to a tab with content
  // reads nothing, because the store outlives the body.
  const started = current !== undefined
  useEffect(() => {
    if (started || !canRead || mode === undefined || selected === undefined) return
    if (mode === 'text-pages') loadPage(viewKey, file, 1, signal, meta.value?.version)
    else if (mode === 'bytes-complete') loadAll(viewKey, file, signal, meta.value?.version)
    else prepareRenderer(viewKey, signal, selected.id, meta.value?.version)
  }, [started, viewKey, file, signal, loadPage, loadAll, prepareRenderer, canRead, mode, selected, meta.value?.version])

  // Come back where the reader was once there is content to scroll: on a remount,
  // after a reload rebuilt the content, after the selected renderer changed, or
  // after the host switched the view a shared body shows. Scroll writes preserve
  // both identities, so they never re-land.
  useEffect(() => {
    const body = scrollportRef.current
    if (hasContent && body !== null && state !== undefined) body.scrollTop = state.scrollTop
  }, [hasContent, viewKey, selected?.id])
  // The viewer menu belongs to the view that opened it.
  useEffect(() => { setMenuOpen(false) }, [viewKey])

  // Answer a navigation once: a line the pages do not reach yet loads the next
  // page (again, until the pages cover it or the file ends); a line they hold
  // is scrolled to and marked with a fading band. The store remembers the
  // answer, so a remount restores the reader's place instead.
  useEffect(() => {
    const body = scrollportRef.current
    if (current === undefined || body === null || current.revision === navigation.revision) return
    if (line === undefined || mode !== 'text-pages') {
      actions.navigated(viewKey, navigation.revision)
      return
    }
    if (line > loadedThrough && !current.eof) {
      if (!current.loading && current.failure === undefined && canRead) {
        loadPage(viewKey, file, loadedThrough + 1, signal, meta.value?.version)
      }
      return
    }
    const row = scrollToLine(body, line)
    if (row === undefined && line <= loadedThrough) return
    if (row !== undefined) markLine(body, row, line)
    actions.navigated(viewKey, navigation.revision)
    // Recorded here as well as by the scroll event, so the store holds the
    // landing before any later navigation reads it.
    actions.scrolled(viewKey, body.scrollTop)
  }, [
    navigation.revision, line, loadedThrough, current?.eof, current?.loading, current?.failure, started,
    selected?.id, mode, file, canRead, meta.value?.version,
  ])

  const rendererReload = useCallback((): void => {
    if (canRead && selected !== undefined) prepareRenderer(viewKey, signal, selected.id, meta.value?.version, true)
  }, [canRead, prepareRenderer, viewKey, signal, selected?.id, meta.value?.version])
  const observedVersion = meta.value?.version
  const changed = (current?.version !== undefined && observedVersion !== undefined
    && observedVersion !== current.version && observedVersion !== current.observedVersion)
    || state?.resourcesDirty === true
  const reload = useCallback((): void => {
    if (!canRead) return
    if (mode === 'text-pages') reloadPages(viewKey, file, signal, observedVersion)
    else if (mode === 'bytes-complete') reloadAll(viewKey, file, signal, observedVersion)
    else rendererReload()
  }, [canRead, mode, reloadPages, reloadAll, rendererReload, viewKey, file, signal, observedVersion])
  useEffect(() => bindRefresh?.({ refresh: reload }), [bindRefresh, reload])
  useEffect(() => {
    if (state?.autoRefresh && changed && current !== undefined && !current.loading && meta.status === 'live') reload()
  }, [state?.autoRefresh, changed, current?.loading, meta.status, reload])
  const content = useMemo((): DocumentContent | undefined => {
    if (mode === 'renderer') {
      if (current === undefined) return undefined
      const revision = current.loadRevision
      return { kind: 'renderer', revision, reload: rendererReload,
        failed: () => { actions.rendererFailed(viewKey, revision) },
        loaded: (version) => { actions.rendered(viewKey, revision, version) } }
    }
    if (mode === 'bytes-complete') {
      return current?.complete === undefined ? undefined : {
        kind: 'bytes', data: current.complete.data,
      }
    }
    if (current === undefined || loaded.length === 0) return undefined
    return { kind: 'text', pages: loaded, text: loaded.filter(page => page.lines > 0).map(page => page.text).join('\n'), eof: current.eof }
  }, [mode, loaded, current?.complete, current?.eof, current?.loadRevision, rendererReload, actions, viewKey])

  // A known binary suffix with no matching renderer never reads: no plain-text
  // fallback, no viewer control, only the path, the unsupported line, and the
  // contributions that hand the file to the Host.
  if (selected === undefined && unviewable) {
    const { name: unsupportedName } = pathPartsOf(displayPath)
    return (
      <div className={css.preview} data-textpreview-state="unsupported" data-textpreview-url={address}>
        <div className={css.header}>
          <PathLabel path={displayPath} className={css.path} data-textpreview-path />
          {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.actions', fileOwner)}
        </div>
        <div className={css.body} data-textpreview-body>
          <div className={css.empty} data-textpreview-unsupported>
            <FileTypeIcon kind={classifyFileType(unsupportedName)} size={36} className={css.emptyIcon} />
            <p className={css.emptyLine}>{t('unsupportedFile')}</p>
            {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.unpreviewable', fileOwner)}
          </div>
        </div>
      </div>
    )
  }
  if (state === undefined || selected === undefined) {
    return (
      <div className={css.status} data-textpreview-state="loading">
        {meta.status === 'none'
          ? <p className={css.statusLine}>{t('resourceUnavailable')}</p>
          : <LoadingIndicator label={t('loading')} />}
      </div>
    )
  }
  const next = loadedThrough + 1
  const { name } = pathPartsOf(displayPath)
  const loadNext = (): void => {
    if (!canRead || current?.loading || current?.eof) return
    loadPage(viewKey, file, next, signal, meta.value?.version)
  }
  return (
    <div className={css.preview} data-textpreview-state="text" data-textpreview-url={address} data-document-preview={selected.id}>
      {meta.failure !== undefined && hasContent
        ? (
          // The file's metadata failed — gone, or its workspace unknown — which
          // outranks a pending change; the pages already read stay under it.
          // With nothing read the body's own failure already says it, so the
          // bar would only repeat the same line.
          <p className={css.changed} data-textpreview-meta-failed={meta.failure.code}>
            <span>{failureLine(t, meta.failure)}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )
        : changed && (
          <p className={css.changed} data-textpreview-changed>
            <span>{t('changed')}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )}
      <div className={css.header}>
        <PathLabel path={displayPath} className={css.path} data-textpreview-path />
        {candidates.length > 1
          && (
            <Menu
              open={menuOpen}
              anchor={(
                <button type="button" className={clsx(css.tool, css.viewerTool)} aria-label={t('openWith')} title={selected.title()} data-document-viewer-menu onClick={() => { setMenuOpen(value => !value) }}>
                  {selected.title()}
                </button>
              )}
              items={candidates.map(candidate => ({ id: candidate.id, label: candidate.title() }))}
              selectedId={selected.id}
              onSelect={(id) => { actions.selected(viewKey, id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              align="end"
              portal
              dense
            />
          )}
        {selected.wrap === true && (
          // The tooltip names the action while the stable aria name and
          // `aria-pressed` expose the control and its current state.
          <Tooltip label={t(state.wrap ? 'wrap.disable' : 'wrap.enable')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.tool}
              aria-pressed={state.wrap}
              aria-label={t('wrap.aria')}
              data-textpreview-tool="wrap"
              onClick={() => {
                actions.toggledWrap(viewKey)
                // Wrapping reflows the lines under a line mark without resizing its scrollport.
                const body = scrollportRef.current
                /* v8 ignore next -- callback refs bind the scrollport during commit, before user input. */
                if (body !== null) clearLineMark(body)
              }}
            >
              {state.wrap ? <IconNowrapFillRegular /> : <IconWrapFillRegular />}
            </button>
          </Tooltip>
        )}
        {content !== undefined && renderSlot('sidebar.right.tab.document.action', { content }, { entryKey: selected.id, hookContext: useDocumentView })}
        <span hidden>
          <Tooltip label={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} aria-label={t('autoRefresh')}
              aria-pressed={state.autoRefresh} data-textpreview-tool="auto-refresh"
              onClick={() => { actions.toggledAutoRefresh(viewKey) }}>
              {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
            </button>
          </Tooltip>
        </span>
        {/* Preview and file-tree refresh controls own different reload lifecycles and locale namespaces. */}
        {/* jscpd:ignore-start */}
        <Tooltip label={t('reload')} shortcutKeys={refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            data-textpreview-tool="reload"
            aria-keyshortcuts={refreshShortcut?.aria}
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
        {/* jscpd:ignore-end */}
        {fileOwner !== undefined && renderSlot('sidebar.right.tab.document.actions', fileOwner)}
      </div>
      <div
        ref={bindBody}
        className={clsx(css.body, state.wrap && css.wrap)}
        data-textpreview-body
        data-textpreview-wrap={state.wrap ? '' : undefined}
        onScrollCapture={(event) => {
          const body = scrollportRef.current
          /* v8 ignore next -- callback refs bind the scrollport during commit, before user input. */
          if (body === null) return
          if (event.target !== body) return
          actions.scrolled(viewKey, body.scrollTop)
          if (mode === 'text-pages' && current?.failure === undefined && body.clientHeight > 0
            && body.scrollTop + body.clientHeight >= body.scrollHeight - 1) loadNext()
        }}
      >
        {mode !== 'renderer' && !hasContent && current?.failure === undefined && (
          <LoadingIndicator label={t('loading')} />
        )}
        {content !== undefined && renderSlot('sidebar.right.tab.document', {
          resourceAddress: address, content, wrap: state.wrap, scrollportRef: bindScrollport,
          addResource: add, setResources: set,
        }, {
          entryKey: selected.id, hookContext: useDocumentView,
          fallback: <p className={css.statusLine}>{t('rendererUnavailable', { name: selected.title() })}</p>,
        })}
        {current?.failure !== undefined && (hasContent
          ? (
            <p className={css.statusLine} data-textpreview-failed={current.failure.code}>
              <span>{failureLine(t, current.failure)}</span>
              <button
                type="button"
                className={css.action}
                data-textpreview-retry
                onClick={loadNext}
              >
                {t('retry')}
              </button>
            </p>
          )
          : (
            // With no content, the failure names its recourse: retry the
            // selected renderer's read when a second read may resolve it, hand
            // a file this preview cannot render to the unpreviewable
            // contributions, and offer nothing for a path with nothing to show.
            // Metadata observation remains owned by the resource provider.
            <div className={css.empty} data-textpreview-failed={current.failure.code}>
              <FileTypeIcon kind={classifyFileType(name)} size={36} className={css.emptyIcon} />
              <p className={css.emptyLine}>{failureLine(t, current.failure)}</p>
              {emptyFailureRecourse(current.failure) === 'open' && fileOwner !== undefined
                && renderSlot('sidebar.right.tab.document.unpreviewable', fileOwner)}
              {emptyFailureRecourse(current.failure) === 'retry' && (
                <button
                  type="button"
                  className={css.retry}
                  data-textpreview-retry
                  onClick={reload}
                >
                  <IconRefreshOutlineRegular size={14} />
                  {t('retry')}
                </button>
              )}
            </div>
          ))}
        {mode === 'text-pages' && current !== undefined && loaded.length > 0 && !current.eof && current.failure === undefined && (
          <button
            type="button"
            className={css.more}
            disabled={current.loading}
            data-textpreview-more
            onClick={loadNext}
          >
            {current.loading ? <LoadingIndicator inline label={t('loading')} /> : t('loadMore')}
          </button>
        )}
      </div>
    </div>
  )
}
