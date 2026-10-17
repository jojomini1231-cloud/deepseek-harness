/**
 * The workbench's open files: one chip each, in the order they were opened.
 *
 * The strip owns no state. It draws the open files it is given and reports the
 * two gestures a reader makes — show a file, close its chip — back to the body.
 * What a chip shows belongs to the content column, not to the strip.
 *
 * With more chips than width the strip scrolls: the wheel moves it horizontally
 * so an overflowing row stays reachable without a scrollbar, and a chip that
 * opens (or becomes shown) out of view is brought back into it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { FileTypeIcon, IconCloseOutlineRegular, Menu, classifyFileType } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'
import type { OpenFile } from './store.ts'
import css from './FilesBody.module.css'

/** One wheel notch reported as lines rather than pixels. */
const WHEEL_LINE_PX = 16

/**
 * The band a chip is kept clear of at a hidden edge, matching the fade the
 * stylesheet draws there, so a chip scrolled to the edge is not half faded.
 */
const EDGE_FADE_PX = 24

/** Which edges of the strip hold chips scrolled out of view. */
type HiddenSides = 'start' | 'end' | 'start end' | undefined

/** The strip's props: the open files, the shown one, and the two gestures. */
export interface FileTabsProps {
  /** The files held open, in the order their chips were opened. */
  readonly files: readonly OpenFile[]
  /** Absolute path of the file the content column shows; absent when nothing is open. */
  readonly active: string | undefined
  /** Show an open file in the content column. */
  readonly onOpen: (path: string) => void
  /** Close an open file's chip. */
  readonly onClose: (path: string) => void
  /** Close every chip but this file's. */
  readonly onCloseOthers: (path: string) => void
  /** Close every chip. */
  readonly onCloseAll: () => void
  /** Close the chips opened before this file's. */
  readonly onCloseLeft: (path: string) => void
  /** Close the chips opened after this file's. */
  readonly onCloseRight: (path: string) => void
  /**
   * Rows other plugins contribute to the menu, rendered after the workbench's
   * own arms; absent means none. The callback dismisses the menu when the row
   * is picked, so a contributed surface closes it on the workbench's behalf.
   */
  readonly renderMenuRow?: (path: string, onPicked: () => void) => ReactNode
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * The menu's rows for one chip, in the order the reader sees them.
 *
 * A row that would remove nothing is disabled rather than hidden, so the menu
 * keeps its shape wherever it is opened.
 * @param t - namespace-bound translate.
 * @param index - the chip's place in the strip.
 * @param count - how many chips the strip holds.
 * @returns the menu entries.
 */
function chipMenu(t: TranslateNS<'sidebarFiles'>, index: number, count: number): readonly MenuEntry[] {
  return [
    { id: 'close', label: t('tabs.menu.close') },
    { id: 'close-others', label: t('tabs.menu.closeOthers'), disabled: count === 1 },
    { id: 'close-all', label: t('tabs.menu.closeAll') },
    { id: 'close-left', label: t('tabs.menu.closeLeft'), disabled: index === 0 },
    { id: 'close-right', label: t('tabs.menu.closeRight'), disabled: index === count - 1 },
  ]
}

/**
 * A wheel notch in pixels, whichever delta mode the device reports.
 * @param event - the wheel event.
 * @returns the horizontal distance to scroll.
 */
function wheelPixels(event: WheelEvent): number {
  // A horizontal gesture (a trackpad's two-finger swipe) already names its axis.
  const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
  return event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * WHEEL_LINE_PX : delta
}

/**
 * Render the open files' chips above the content column.
 * @param props - the open files, the shown one, and the two gestures.
 * @returns the strip, or nothing when no file is open.
 */
export function FileTabs({
  files, active, onOpen, onClose, onCloseOthers, onCloseAll, onCloseLeft, onCloseRight, renderMenuRow, t,
}: FileTabsProps): ReactNode {
  const strip = useRef<HTMLDivElement | null>(null)
  const [hidden, setHidden] = useState<HiddenSides>(undefined)
  const [menu, setMenu] = useState<string | undefined>(undefined)
  const hasFiles = files.length > 0
  // Which edges hold chips scrolled out of view: the stylesheet fades them, so
  // an overflowing row reads as continuing rather than as cut off. Read after
  // every commit that changes the chips, on scroll, and on resize — the fade is
  // orientation chrome, never state another render derives from.
  useLayoutEffect(() => {
    const element = strip.current
    if (element === null) return undefined
    const apply = (): void => {
      // Sub-pixel scroll positions: a side counts as hidden past one whole pixel.
      const start = element.scrollLeft > 1
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setHidden(start && end ? 'start end' : start ? 'start' : end ? 'end' : undefined)
    }
    apply()
    element.addEventListener('scroll', apply, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', apply)
      observer?.disconnect()
    }
  }, [hasFiles, files.length])
  // The strip draws no scrollbar, so the wheel is what moves it. A listener
  // rather than a React prop: the browser needs a non-passive wheel handler to
  // let the strip keep a notch it consumed instead of scrolling an ancestor.
  useEffect(() => {
    const element = strip.current
    if (element === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      const delta = wheelPixels(event)
      const maximum = element.scrollWidth - element.clientWidth
      if (delta === 0 || maximum <= 0) return
      const next = Math.max(0, Math.min(maximum, element.scrollLeft + delta))
      if (next === element.scrollLeft) return
      element.scrollLeft = next
      event.preventDefault()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [hasFiles])
  // A chip that opened or became the shown one past the strip's edge is brought
  // back into view, without moving any ancestor's scroll.
  useLayoutEffect(() => {
    const element = strip.current
    if (element === null || active === undefined) return
    const chip = [...element.querySelectorAll<HTMLElement>('[data-files-tab]')]
      .find(node => node.dataset.filesTab === active)
    if (chip === undefined) return
    const box = element.getBoundingClientRect()
    const rect = chip.getBoundingClientRect()
    if (rect.left < box.left) element.scrollLeft += rect.left - box.left - EDGE_FADE_PX
    else if (rect.right > box.right) element.scrollLeft += rect.right - box.right + EDGE_FADE_PX
  }, [active, files.length])
  // The menu acts on the chip it was opened from: the path it holds is the one
  // every close arm needs.
  const menuAction = (path: string, id: string): void => {
    switch (id) {
      case 'close': onClose(path); return
      case 'close-others': onCloseOthers(path); return
      case 'close-all': onCloseAll(); return
      case 'close-left': onCloseLeft(path); return
      case 'close-right': onCloseRight(path); return
      /* v8 ignore next -- closed union of the menu's own ids. */
      default: return
    }
  }
  if (!hasFiles) return null
  return (
    <div
      ref={strip}
      className={css.tabs}
      role="tablist"
      aria-label={t('tabs.aria')}
      data-files-tabs
      data-files-tabs-scroll={hidden}
    >
      {files.map((file, index) => (
        <span
          key={file.path}
          className={clsx(css.tab, file.path === active && css.tabActive)}
          data-files-tab={file.path}
          onContextMenu={(event) => { event.preventDefault(); setMenu(file.path) }}
        >
          <Menu
            className={css.chipAnchor}
            open={menu === file.path}
            portal
            anchor={(
              <button
                type="button"
                role="tab"
                className={css.tabButton}
                aria-selected={file.path === active}
                data-files-tab-open={file.path}
                onAuxClick={(event) => { if (event.button === 1) onClose(file.path) }}
                onClick={() => { onOpen(file.path) }}
              >
                <FileTypeIcon kind={classifyFileType(file.name)} size={14} className={css.tabIcon} />
                <span className={css.tabName} title={file.path}>{file.name}</span>
              </button>
            )}
            items={chipMenu(t, index, files.length)}
            onSelect={(id) => { setMenu(undefined); menuAction(file.path, id) }}
            onClose={() => { setMenu(undefined) }}
          >
            {renderMenuRow?.(file.path, () => { setMenu(undefined) })}
          </Menu>
          <button
            type="button"
            className={css.tabClose}
            aria-label={t('tabs.close', { name: file.name })}
            data-files-tab-close={file.path}
            onClick={() => { onClose(file.path) }}
          >
            <IconCloseOutlineRegular />
          </button>
        </span>
      ))}
    </div>
  )
}
