/**
 * The two-segment comparison layout control shared by the working-tree git
 * view and the commit page.
 *
 * Its own button group rather than the shared `SegmentedControl`: a segmented
 * control is a tablist whose options select panels, while both buttons here
 * describe one comparison that stays on screen. The `data-*` hook the browser
 * specs use is supplied by the caller, so each view keeps its own stable name.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './DiffModeControl.module.css'

/** How a file comparison is laid out: one unified column, or both sides. */
export type DiffMode = 'unified' | 'split'

/** The comparison layouts, in control order. */
const MODES = ['unified', 'split'] as const

/** The control's props: the shown layout, the pick gesture, and the data hook. */
export interface DiffModeControlProps {
  /** The layout the view is drawing. */
  readonly mode: DiffMode
  /** Choose a layout. */
  readonly onMode: (mode: DiffMode) => void
  /** The stable `data-*` attribute naming each button, for browser specs. */
  readonly dataAttr: 'data-files-git-diff-mode' | 'data-files-history-diff-mode'
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Render the comparison layout control.
 * @param props.mode - the shown layout.
 * @param props.onMode - the pick gesture.
 * @param props.dataAttr - the per-view data hook each button carries.
 * @param props.t - namespace translator.
 * @returns the two segmented buttons.
 */
export function DiffModeControl({ mode, onMode, dataAttr, t }: DiffModeControlProps): ReactNode {
  return (
    <div className={css.mode} role="group" aria-label={t('diff.mode.aria')}>
      {MODES.map(choice => (
        <button
          key={choice}
          type="button"
          className={clsx(css.button, choice === mode && css.active)}
          aria-pressed={choice === mode}
          {...{ [dataAttr]: choice }}
          onClick={() => { onMode(choice) }}
        >
          {t(choice === 'unified' ? 'diff.mode.unified' : 'diff.mode.split')}
        </button>
      ))}
    </div>
  )
}
