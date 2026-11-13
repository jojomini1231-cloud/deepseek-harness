/**
 * The content-search bar over one document.
 *
 * The bar owns no search state and measures nothing: it shows the query, the
 * counter, and the controls, and reports what the reader asked for. Locating
 * matches, painting them, and scrolling to them belong to the body that draws
 * the document, because the drawn text is what a match addresses.
 */
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconSearchOutlineRegular, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import css from './FindBar.module.css'

/** The bar's localized copy, resolved by its owner. */
export interface FindBarLabels {
  /** Name of the field, also its placeholder. */
  readonly search: string
  /** Previous match. */
  readonly previous: string
  /** Next match. */
  readonly next: string
  /** Close the search. */
  readonly close: string
  /** The counter, already formatted for the matches found. */
  readonly count: string
}

/** Props of {@link FindBar}. */
export interface FindBarProps {
  /** What the reader is searching for. */
  readonly query: string
  /** The bar's localized copy. */
  readonly labels: FindBarLabels
  /** The field itself, so the owner can focus it when the bar opens. */
  readonly inputRef: RefObject<HTMLInputElement>
  /** Whether a non-empty query matched nothing. */
  readonly noResults: boolean
  /** Whether stepping is possible; false until two matches exist. */
  readonly steppable: boolean
  /** @param query - the whole new query. */
  readonly onQuery: (query: string) => void
  /** @param delta - `1` for the next match, `-1` for the previous one. */
  readonly onStep: (delta: 1 | -1) => void
  readonly onClose: () => void
}

/**
 * The document's content-search bar.
 * @param props - the query, the counter, the controls' copy, and what to do.
 * @returns the bar between the header and the document.
 */
export function FindBar({
  query, labels, inputRef, noResults, steppable, onQuery, onStep, onClose,
}: FindBarProps): ReactNode {
  // Escape closes from the field or from any of the controls. The document's
  // own Escape handling checks `defaultPrevented`, so the navigator beside the
  // document stays open.
  const closeOnEscape = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }
  const enterSteps = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (steppable) onStep(event.shiftKey ? -1 : 1)
  }
  return (
    <div className={css.bar} data-textpreview-find onKeyDown={closeOnEscape}>
      <Input
        ref={inputRef}
        className={clsx(css.field)}
        type="search"
        icon={<IconSearchOutlineRegular />}
        value={query}
        placeholder={labels.search}
        aria-label={labels.search}
        onChange={(event) => { onQuery(event.target.value) }}
        onKeyDown={enterSteps}
      />
      <span
        className={css.count}
        data-textpreview-find-count
        data-empty={noResults ? '' : undefined}
        aria-live="polite"
      >
        {labels.count}
      </span>
      <button
        type="button"
        className={css.step}
        aria-label={labels.previous}
        disabled={!steppable}
        data-textpreview-find-step="previous"
        onClick={() => { onStep(-1) }}
      >
        <IconChevronUpOutlineRegular />
      </button>
      <button
        type="button"
        className={css.step}
        aria-label={labels.next}
        disabled={!steppable}
        data-textpreview-find-step="next"
        onClick={() => { onStep(1) }}
      >
        <IconChevronDownOutlineRegular />
      </button>
      <button
        type="button"
        className={css.step}
        aria-label={labels.close}
        data-textpreview-find-close
        onClick={onClose}
      >
        <IconCloseOutlineRegular />
      </button>
    </div>
  )
}
