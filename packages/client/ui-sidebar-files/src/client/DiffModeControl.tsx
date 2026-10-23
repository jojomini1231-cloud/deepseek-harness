/**
 * The comparison layout toggle shared by the working-tree git view and the
 * commit page.
 *
 * Icon-only, like the change review's own layout control: the comparison glyph
 * turns a quarter when the sides split, `aria-pressed` states that choice, and
 * the tooltip names the layout the press would switch to. The `data-*` hook the
 * browser specs use carries the shown layout and is supplied by the caller, so
 * each view keeps its own stable attribute.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { IconCompareSplitOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './DiffModeControl.module.css'
import toggleCss from './DiffToggle.module.css'

/** How a file comparison is laid out: one unified column, or both sides. */
export type DiffMode = 'unified' | 'split'

/** The control's props: the shown layout, the pick gesture, and the data hook. */
export interface DiffModeControlProps {
  /** The layout the view is drawing. */
  readonly mode: DiffMode
  /** Choose a layout. */
  readonly onMode: (mode: DiffMode) => void
  /** The stable `data-*` attribute carrying the shown layout, for browser specs. */
  readonly dataAttr: 'data-files-git-diff-mode' | 'data-files-history-diff-mode'
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Render the comparison layout toggle.
 * @param props.mode - the shown layout.
 * @param props.onMode - the pick gesture.
 * @param props.dataAttr - the per-view data hook.
 * @param props.t - namespace translator.
 * @returns one icon button that picks the other layout.
 */
export function DiffModeControl({ mode, onMode, dataAttr, t }: DiffModeControlProps): ReactNode {
  const split = mode === 'split'
  return (
    <Tooltip label={t(split ? 'diff.mode.unified' : 'diff.mode.split')} side="bottom" delayMs={300}>
      <button
        type="button"
        className={clsx(toggleCss.tool, split && css.split)}
        aria-pressed={split}
        aria-label={t('diff.mode.aria')}
        {...{ [dataAttr]: mode }}
        onClick={() => { onMode(split ? 'unified' : 'split') }}
      >
        <IconCompareSplitOutlineRegular className={css.icon} />
      </button>
    </Tooltip>
  )
}
