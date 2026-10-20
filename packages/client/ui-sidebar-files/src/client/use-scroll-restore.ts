/**
 * The scroll position a pane's own scroller keeps across unmounts.
 *
 * A container switch unmounts the view that owns the scroller, and the two
 * workbench panes both come back where the reader left them. The position
 * lives in a ref rather than the store so a scroll neither re-renders the pane
 * nor writes to a bucket the record's abort may already have dropped; the
 * owner hears about it once, on unmount.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

/** What the pane holds: the scroller's callback ref and its live offset. */
export interface ScrollRestore {
  /** Callback ref for the scroller: it restores the offset when the node mounts. */
  readonly scrollRef: (node: HTMLDivElement | null) => void
  /** The scroller's element, once mounted. */
  readonly elementRef: MutableRefObject<HTMLDivElement | null>
  /** The offset the scroller is at, kept current by the pane's scroll handler. */
  readonly scrollTopRef: MutableRefObject<number>
}

/**
 * Follow one scroller's offset.
 * @param initial - the offset to restore on mount.
 * @param report - receives the offset when the pane unmounts.
 * @returns the scroller's callback ref, its element ref, and the live offset.
 */
export function useScrollRestore(initial: number, report: (top: number) => void): ScrollRestore {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const scrollTopRef = useRef(initial)
  // The owner's callback may change between renders; the unmount effect must
  // call the latest one without restarting on every parent render.
  const reportLatest = useRef(report)
  useEffect(() => { reportLatest.current = report })
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node
    if (node !== null) node.scrollTop = scrollTopRef.current
  }, [])
  useEffect(() => () => { reportLatest.current(scrollTopRef.current) }, [])
  return { scrollRef, elementRef, scrollTopRef }
}
