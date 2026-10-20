/**
 * The clock the history view dates its rows with.
 *
 * Relative labels change at minute granularity, so the view reads the clock on
 * a minute timer rather than on every render: the panel re-renders on every
 * store write, and a per-render `Date.now()` would hand every row a new time
 * and re-date the whole list under a scroll.
 */
import { useEffect, useState } from 'react'

/** How often the clock value is refreshed, in ms. */
const TICK_MS = 60_000

/**
 * Read the current epoch ms, refreshed once a minute.
 * @returns the current time, stable between ticks.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])
  return now
}
