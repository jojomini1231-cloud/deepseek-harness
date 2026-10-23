/**
 * The comparison scope toggle shared by the working-tree git view and the
 * commit page.
 *
 * Icon-only, like the layout toggle beside it: the glyph states whether the
 * whole file or only its changed hunks are drawn, `aria-pressed` states that
 * whole-file choice, and the tooltip names the scope the press would switch to.
 * The `data-*` hook the browser specs use carries the shown scope and is
 * supplied by the caller, so each view keeps its own stable attribute.
 */
import type { ReactNode } from 'react'
import { IconDiffHunksOutlineRegular, IconFullFileOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './DiffToggle.module.css'

/** Which part of a file a comparison covers: the whole file, or only its changed hunks. */
export type DiffScope = 'complete' | 'changes'

/** The control's props: the shown scope, the pick gesture, and the data hook. */
export interface DiffScopeControlProps {
  /** Whether the comparison draws the whole file rather than the changed hunks alone. */
  readonly complete: boolean
  /** Choose a scope; `true` asks for the whole file. */
  readonly onComplete: (complete: boolean) => void
  /** The stable `data-*` attribute carrying the shown scope, for browser specs. */
  readonly dataAttr: 'data-files-git-diff-scope' | 'data-files-history-diff-scope'
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Render the comparison scope toggle.
 * @param props.complete - whether the whole file is drawn.
 * @param props.onComplete - the pick gesture.
 * @param props.dataAttr - the per-view data hook.
 * @param props.t - namespace translator.
 * @returns one icon button that picks the other scope.
 */
export function DiffScopeControl({ complete, onComplete, dataAttr, t }: DiffScopeControlProps): ReactNode {
  return (
    <Tooltip label={t(complete ? 'diff.scope.changes' : 'diff.scope.full')} side="bottom" delayMs={300}>
      <button
        type="button"
        className={css.tool}
        aria-pressed={complete}
        aria-label={t('diff.scope.aria')}
        {...{ [dataAttr]: complete ? 'complete' : 'changes' }}
        onClick={() => { onComplete(!complete) }}
      >
        {complete ? <IconFullFileOutlineRegular /> : <IconDiffHunksOutlineRegular />}
      </button>
    </Tooltip>
  )
}
