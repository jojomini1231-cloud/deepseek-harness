/**
 * The history navigator's refs filter: a chip that opens a searchable popover
 * with "all refs" (`HEAD`) and the repository's local branches, remotes, and
 * tags grouped.
 *
 * The popover portals to the document body and follows the chip through the
 * shared anchored-position hook, because the history columns clip their
 * overflow; its material is the shared `MenuSurface`, so it carries the
 * product's menu fill and blur. The filter only changes what the list walks —
 * it never switches branches.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  Button, focusWithoutRing, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconSearchOutlineRegular,
  Input, MenuGroup, MenuSurface, observeStickyMenuGroups, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitRef } from '@deepseek-ai/dsh-workspace-changes/types'
import { refDisplayName } from './history.ts'
import type {} from './locales.ts'
import css from './HistoryPanel.module.css'

/** Distance between the chip and the popover. */
const MENU_GAP = 4

/** Viewport margin the popover keeps clear. */
const VIEWPORT_MARGIN = 12

/** Unplaced popover: laid out but hidden, so the first placement measures real dimensions. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** The ref groups the popover draws, in order. */
const GROUPS = ['local', 'remote', 'tag'] as const

/** One group of ref rows, filtered by the search text. */
interface RefGroup {
  readonly kind: (typeof GROUPS)[number]
  readonly label: string
  readonly refs: readonly WorkspaceGitRef[]
}

/** The filter's props: the refs and the gestures the navigator owns. */
export interface HistoryRefsFilterProps {
  /** The refs the repository reports, `undefined` until the first answer arrives. */
  readonly refs: readonly WorkspaceGitRef[] | undefined
  /** Whether the latest refs read failed. */
  readonly refsFailure: boolean
  /** The walked ref's full name, `undefined` for all refs at `HEAD`. */
  readonly selected: string | undefined
  /** Walk one ref by its full name, or `HEAD` when undefined. */
  readonly onSelect: (ref: string | undefined) => void
  /** Read the refs again. */
  readonly onRetry: () => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Render the refs filter chip and its popover.
 * @param props.refs - the refs the repository reports.
 * @param props.refsFailure - whether the latest refs read failed.
 * @param props.selected - the walked ref, `undefined` for all refs.
 * @param props.onSelect - the pick gesture.
 * @param props.onRetry - read the refs again.
 * @param props.t - namespace translator.
 * @returns the chip, and the popover while it is open.
 */
export function HistoryRefsFilter({
  refs, refsFailure, selected, onSelect, onRetry, t,
}: HistoryRefsFilterProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const position = useAnchoredPosition({
    open, anchorRef: triggerRef, panelRef, gap: MENU_GAP, margin: VIEWPORT_MARGIN, align: 'end',
  })
  const close = (): void => {
    setOpen(false)
    setQuery('')
  }
  // Every close path clears the search text, including an outside press, so a
  // reopened popover starts from the full list. The callback identity is stable
  // because the dismissal hook re-registers its listener whenever it changes.
  const dismiss = useCallback((): void => {
    setOpen(false)
    setQuery('')
  }, [])
  useDismissOnOutsidePointer(triggerRef, open, dismiss, panelRef)
  // The search box takes the keyboard when the popover opens, and the text is
  // cleared when it closes so a reopened popover starts from the full list.
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])
  // The heading fills follow the rows the search leaves; the observer is
  // disposed before the changed groups are observed again.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!open || viewport === null) return undefined
    return observeStickyMenuGroups(viewport)
  }, [open, query, refs])

  const needle = query.trim().toLowerCase()
  const match = (ref: WorkspaceGitRef): boolean => needle === '' || ref.name.toLowerCase().includes(needle)
  const groups: RefGroup[] = GROUPS.flatMap((kind) => {
    const matched = (refs ?? []).filter(ref => ref.kind === kind && match(ref))
    return matched.length === 0 ? [] : [{
      kind,
      label: t(kind === 'local' ? 'history.refs.local' : kind === 'remote' ? 'history.refs.remote' : 'history.refs.tag'),
      refs: matched,
    }]
  })
  const matchedCount = groups.reduce((count, group) => count + group.refs.length, 0)
  // The chip names the walked ref by its display name; a ref the repository no
  // longer reports is the one the host is about to drop.
  const selectedLabel = selected === undefined
    ? t('history.refs.all')
    : refDisplayName((refs ?? []).find(ref => ref.refname === selected)?.name ?? selected)

  const pick = (ref: string | undefined): void => {
    close()
    const trigger = triggerRef.current
    /* v8 ignore next -- the chip is mounted while its own popover is open. */
    if (trigger !== null) focusWithoutRing(trigger)
    onSelect(ref)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      triggerRef.current?.focus()
      return
    }
    // The popover is portalled to the body, so a Tab that leaves the panel
    // lands on the page behind it and takes the arrow walk and Escape with it.
    // Tab and Shift+Tab cycle inside the panel instead, the way the shared
    // Menu keeps its portalled list operable.
    if (event.key === 'Tab') {
      const panel = panelRef.current
      /* v8 ignore next -- the popover's panel is attached while its own key handler runs. */
      if (panel === null) return
      // The search box can be unfocused while the popover is open, so the walk
      // keeps only the stops that exist. The panel's own rows always remain:
      // the all-refs sentinel is rendered for every state it draws.
      const stops = [
        searchRef.current,
        ...panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].filter((stop): stop is HTMLInputElement | HTMLButtonElement => stop !== null)
      event.preventDefault()
      const at = stops.indexOf(document.activeElement as HTMLButtonElement)
      // Focus outside the walk forwards to its first stop and backwards to its
      // last, rather than to whatever the arithmetic happens to land on.
      const next = event.shiftKey
        ? (at <= 0 ? stops.length - 1 : at - 1)
        : (at === -1 ? 0 : (at + 1) % stops.length)
      stops[next]?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    /* v8 ignore next -- the handler runs on the open popover, so its ref is attached. */
    const rows = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (rows.length === 0) return
    event.preventDefault()
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : index < 0
          ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    rows[next]?.focus()
  }

  /** One ref row; the check marks the ref the list is walking. The React key
   * is the kind and full name, because a branch and a tag can share a display
   * name; the row hook carries the display name a reader picks by. A ref name
   * cannot contain `:`, so the all-refs sentinel's `:all` key never collides. */
  const row = (identity: string, label: string, active: boolean, onPick: () => void, dataRef: string = identity, kind: string = ''): ReactNode => {
    // Both the row's text and its hover title draw the name, so both take the
    // stripped form; the hooks keep the name the repository reported.
    const shown = refDisplayName(label)
    return (
      <button
        key={`${kind}:${identity}`}
        type="button"
        role="menuitem"
        aria-current={active ? 'true' : undefined}
        className={clsx(css.refOption, active && css.refOptionActive)}
        data-files-history-ref={dataRef}
        data-files-history-refname={identity}
        onClick={onPick}
      >
        <span className={css.refMark}>{active ? <IconCheckOutlineRegular size={12} /> : null}</span>
        <span className={css.refName} title={shown}>{shown}</span>
      </button>
    )
  }

  const popover = (
    <MenuSurface
      ref={panelRef}
      className={css.refsMenu}
      style={position ?? MEASURE_STYLE}
      role="dialog"
      aria-label={t('history.refs.menu')}
      onKeyDown={onKeyDown}
    >
      <Input
        ref={searchRef}
        className={clsx(css.refsSearch)}
        icon={<IconSearchOutlineRegular />}
        value={query}
        placeholder={t('history.refs.search')}
        aria-label={t('history.refs.search')}
        data-files-history-refs-search
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {refs === undefined
        ? (
          <div className={css.refsNote} data-files-history-refs-state={refsFailure ? 'failed' : 'loading'}>
            <span>{refsFailure ? t('history.refs.failed') : t('history.refs.loading')}</span>
            {refsFailure && (
              <Button size="sm" data-files-history-refs-retry onClick={onRetry}>{t('retry')}</Button>
            )}
          </div>
        )
        : (
          <div ref={viewportRef} className={css.refsGroups} role="menu" aria-label={t('history.refs.menu')}>
            <MenuGroup label={t('history.refs.all')}>
              {/* The sentinel's hook carries a colon, which no git ref name
                  may hold, so a branch named `all` keeps its own row. */}
              {row('all', t('history.refs.all'), selected === undefined, () => { pick(undefined) }, ':all', 'all')}
            </MenuGroup>
            {groups.map(group => (
              <MenuGroup key={group.kind} label={group.label}>
                {group.refs.map(ref => row(
                  ref.refname, ref.name, selected === ref.refname, () => { pick(ref.refname) }, ref.name, group.kind,
                ))}
              </MenuGroup>
            ))}
            {needle !== '' && matchedCount === 0 && (
              <p className={css.refsNote} data-files-history-refs-state="empty">{t('history.refs.empty')}</p>
            )}
          </div>
        )}
      <p className={css.refsHint}>{t('history.refs.hint')}</p>
    </MenuSurface>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={css.refsChip}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('history.refs.chip')}
        data-files-history-refs
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
      >
        <span className={css.refsChipLabel}>{selectedLabel}</span>
        <IconChevronDownOutlineRegular size={12} />
      </button>
      {open ? createPortal(popover, document.body) : null}
    </>
  )
}
