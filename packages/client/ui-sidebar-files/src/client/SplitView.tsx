/**
 * The workbench's two columns: content on the leading side, the tree on the
 * trailing one, and a divider between them.
 *
 * A drag previews in this component's own state and reports one settled ratio
 * when the pointer is released, so the body's store — and with it every other
 * reader of the layout — sees one value per gesture. The columns it is given are
 * elements the body memoizes, so a drag frame re-renders the divider and not the
 * document behind it.
 */
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_RATIO, MIN_RATIO } from './store.ts'
import css from './FilesBody.module.css'

/** The workbench's props: what each side shows and where the divider stands. */
export interface SplitViewProps {
  /** The content column's share of the workbench, between `MIN_RATIO` and `MAX_RATIO`. */
  readonly ratio: number
  /** Report the ratio a completed drag settled on. */
  readonly onRatio: (ratio: number) => void
  /** The leading column: the open files' chips and the file the reader is looking at. */
  readonly content: ReactNode
  /** The trailing column: the workspace tree. */
  readonly tree: ReactNode
  /** The divider's accessible name. */
  readonly label: string
}

/** Clamp a candidate share into the draggable range. */
function clamp(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

/**
 * Render one draggable divider between two columns.
 * @param props - the columns, the settled ratio, and the settle callback.
 * @returns the workbench's two columns.
 */
export function SplitView({ ratio, onRatio, content, tree, label }: SplitViewProps): ReactNode {
  const container = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<number>()
  const applied = dragging ?? ratio
  // The container's box, measured once when the drag starts and held: reading
  // it per move event would force a layout on every pointer event, and the
  // drag itself changes no sizes. A width change mid-drag — a viewport resized
  // with the pointer down — re-measures instead of dividing by a stale width.
  const measured = useRef<{ readonly left: number; readonly width: number } | undefined>(undefined)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = container.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    measured.current = { left: box.left, width: box.width }
    setDragging(clamp((event.clientX - box.left) / box.width))
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const box = measured.current
    if (box === undefined || box.width === 0) return
    const live = container.current?.getBoundingClientRect()
    const next = live !== undefined && live.width !== box.width ? live : box
    measured.current = next
    setDragging(clamp((event.clientX - next.left) / next.width))
  }, [])
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const box = measured.current
    measured.current = undefined
    setDragging(undefined)
    if (box === undefined || box.width === 0) return
    onRatio(clamp((event.clientX - box.left) / box.width))
  }, [onRatio])

  return (
    <div
      ref={container}
      className={css.workbench}
      data-files-workbench
      data-files-dragging={dragging !== undefined || undefined}
    >
      <div className={css.contentColumn} style={{ flexBasis: `${applied * 100}%` }} data-files-content-column>
        {content}
      </div>
      <div
        className={css.splitter}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        data-files-splitter
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { setDragging(undefined) }}
      />
      <div className={css.treeColumn} data-files-tree-column>
        {tree}
      </div>
    </div>
  )
}
