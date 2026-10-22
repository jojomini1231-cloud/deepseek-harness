/**
 * The keyboard's path through a narrow layout's drill-down.
 *
 * Opening one and leaving it each unmount the control that held focus, so
 * without a hand-off focus lands on the document body and the next Tab restarts
 * at the top of the page. The panel moves it to the control its own state names:
 * the back control as the drill-down opens, and the row the reader came from
 * when the list returns, or the list's own action when that row is gone.
 *
 * Two flips move nothing. One caused by the measured width alone is a resize,
 * and one that left the keyboard on a live control did not lose it: a store
 * write settling behind a reader who is busy elsewhere keeps its hands off.
 */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { focusWithoutRing } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Hand keyboard focus over when a narrow layout's drill-down opens or closes.
 * @param root - the panel element whose controls receive the focus.
 * @param open - whether the drill-down is the view on screen.
 * @param layout - whether the measured layout is narrow; a flip caused by this
 * value alone moves nothing.
 * @param resolve - the landing control inside the panel for the state now shown;
 * each state a flip reaches draws one.
 */
export function useDrillDownFocus(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  layout: boolean,
  resolve: (panel: HTMLElement, open: boolean) => HTMLElement | null,
): void {
  const previousOpen = useRef(open)
  const previousLayout = useRef(layout)
  // The resolver closes over the state of the render it was created in, and the
  // flip must resolve against the committed state, which is the one now drawn.
  // It is declared first so it runs before the flip effect on every commit.
  const latest = useRef(resolve)
  useEffect(() => { latest.current = resolve })
  useEffect(() => {
    const was = previousOpen.current
    const wasLayout = previousLayout.current
    previousOpen.current = open
    previousLayout.current = layout
    if (was === open || wasLayout !== layout) return
    // A control that unmounted with the view it was in leaves the body focused.
    // One still held elsewhere never left its owner's hands, so it keeps them.
    if (document.activeElement !== document.body) return
    const panel = root.current
    /* v8 ignore next -- the panel holds one root across both of its states. */
    if (panel === null) return
    const target = latest.current(panel, open)
    /* v8 ignore next -- both states draw the control their resolver names. */
    if (target !== null) focusWithoutRing(target)
  }, [open, layout, root])
}
