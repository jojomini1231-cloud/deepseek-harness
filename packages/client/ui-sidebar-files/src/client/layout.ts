/**
 * The measured-width switch every workbench container uses: a container drops
 * to one column below `NARROW_LAYOUT_WIDTH` of its own panel width, not at a
 * window media query, because the right Sidebar is resizable and the same
 * window holds both layouts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Below this measured panel width a workbench container draws one column. */
const NARROW_LAYOUT_WIDTH = 560

/** One container's measured layout: the element to observe and the switch. */
export interface NarrowLayout {
  /** The observed element, for focus and query work after layout. */
  readonly root: RefObject<HTMLDivElement | null>
  /** Attach to the container whose width decides the layout. */
  readonly setRoot: (element: HTMLDivElement | null) => void
  /** Whether the measured width is below the narrow threshold. */
  readonly narrow: boolean
}

/**
 * Observe one container's own width and report whether it is narrow.
 *
 * A hidden or not-yet-laid-out panel measures zero and keeps the wide layout:
 * only a real measured width crosses the threshold.
 * @returns the element ref and the current narrow state.
 */
export function useNarrowLayout(): NarrowLayout {
  const root = useRef<HTMLDivElement | null>(null)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  // The observed element can arrive after the first render (a container that
  // waits for its store bucket), so the observer follows the attachment rather
  // than one mount-time ref read.
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    root.current = node
    setElement(node)
  }, [])
  useEffect(() => {
    if (element === null) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width === 0) return
      setNarrow(width < NARROW_LAYOUT_WIDTH)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [element])
  return { root, setRoot, narrow }
}
