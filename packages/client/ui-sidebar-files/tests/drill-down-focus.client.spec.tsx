// @vitest-environment jsdom
/** The narrow drill-down's keyboard hand-off, over a panel that flips its own view. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useDrillDownFocus } from '../src/client/drill-down-focus.ts'

afterEach(() => { cleanup() })

/** The panel under test: its view follows `open`, and its list marks `selected`. */
function Panel({ open, layout, selected }: {
  readonly open: boolean
  readonly layout: boolean
  readonly selected: string | undefined
}): ReactNode {
  const root = useRef<HTMLDivElement | null>(null)
  useDrillDownFocus(root, open, layout, (panel, shown) => {
    if (shown) return panel.querySelector<HTMLElement>('[data-back]')
    const rows = panel.querySelectorAll<HTMLElement>('[data-row]')
    const row = selected === undefined
      ? undefined
      : [...rows].find(candidate => candidate.dataset.row === selected)
    return row ?? panel.querySelector<HTMLElement>('[data-refresh]')
  })
  return (
    <div ref={root} data-panel>
      {open
        ? <button type="button" data-back>back</button>
        : (
          <>
            <button type="button" data-refresh>reread</button>
            <button type="button" data-row="a">a</button>
            <button type="button" data-row="b">b</button>
          </>
        )}
    </div>
  )
}

describe('useDrillDownFocus', () => {
  it('takes the keyboard when the flip unmounted the control that held it', () => {
    const { rerender } = render(<Panel open={false} layout selected="a" />)
    fireEvent.click(screen.getByText('a'))
    // The click's row unmounts with the list, leaving the page body focused.
    rerender(<Panel open layout selected="a" />)
    expect(document.activeElement).toBe(document.querySelector('[data-back]'))
  })

  it('leaves the keyboard with a live control it did not unmount', () => {
    const { rerender } = render(
      <>
        <input aria-label="search" />
        <Panel open={false} layout selected="a" />
      </>,
    )
    const search = screen.getByLabelText('search')
    act(() => { search.focus() })
    // A store write opened the drill-down behind a reader typing elsewhere.
    rerender(
      <>
        <input aria-label="search" />
        <Panel open layout selected="a" />
      </>,
    )
    expect(document.activeElement).toBe(search)
  })

  it('moves nothing when only the measured layout flips', () => {
    const { rerender } = render(
      <>
        <input aria-label="search" />
        <Panel open={false} layout={false} selected="a" />
      </>,
    )
    const search = screen.getByLabelText('search')
    act(() => { search.focus() })
    rerender(
      <>
        <input aria-label="search" />
        <Panel open={false} layout selected="a" />
      </>,
    )
    expect(document.activeElement).toBe(search)
  })

  it('resolves the landing control against the selection the flip committed', () => {
    const { rerender } = render(<Panel open layout selected="a" />)
    // The list returns with another row selected: the resolver reads the
    // committed state rather than the closure of the render that created it.
    rerender(<Panel open={false} layout selected="b" />)
    expect(document.activeElement).toBe(document.querySelector('[data-row="b"]'))
    // Nor is there a row to return to when the selection went away with the
    // drill-down: the list's own reread takes the keyboard instead.
    rerender(<Panel open layout selected={undefined} />)
    rerender(<Panel open={false} layout selected={undefined} />)
    expect(document.activeElement).toBe(document.querySelector('[data-refresh]'))
  })
})
