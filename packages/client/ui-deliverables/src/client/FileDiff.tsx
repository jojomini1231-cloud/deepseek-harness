/** Shared file comparison for the turn-tail hover preview and Sidebar review. */
import type { ReactNode } from 'react'
import { Button, DiffHunks } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesDiff } from '../changes.ts'
import type { ChangesDiffState } from './changes-diff.ts'
import type { NS } from './locales.ts'
import css from './FileDiff.module.css'

/** The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff: Extract<ChangesDiff, { kind: 'text' }>): 'diff.created' | 'diff.deleted' | 'diff.unchanged' | undefined {
  if (!diff.before) return 'diff.created'
  if (!diff.after) return 'diff.deleted'
  if (diff.hunks.length === 0) return 'diff.unchanged'
  return undefined
}

/**
 * Render a file comparison with the same states and highlighting in previews and review tabs.
 * Addition-only and deletion-only comparisons use one column without changing the requested layout.
 * @param props - comparison state, layout choices, retry action, and localized copy.
 * @returns the comparison or its loading, unavailable, or error state.
 */
export function FileDiff({ state, split, wrap, retry, t }: {
  state: ChangesDiffState | undefined
  split: boolean
  wrap: boolean
  retry: () => void
} & PropsLocale<typeof NS>): ReactNode {
  if (state === undefined || state === 'loading') return <p className={css.status} role="status">{t('diff.loading')}</p>
  if (state === 'missing') return <p className={css.status}>{t('diff.missing')}</p>
  if (state === 'error') {
    return <div className={css.status}><span>{t('diff.error')}</span><Button size="sm" onClick={retry}>{t('presented.retry')}</Button></div>
  }
  if (state.kind === 'binary') return <p className={css.status}>{t('diff.binary')}</p>
  if (state.kind === 'oversized') return <p className={css.status}>{t('diff.oversized')}</p>
  return <TextDiff diff={state} split={split} wrap={wrap} t={t} />
}

/**
 * The comparison's hunks, drawn by the shared numbered renderer.
 * @param props - the comparison, layout choices, and localized chrome.
 * @returns the hunks in the requested layout.
 */
function TextDiff({ diff, split, wrap, t }: { diff: Extract<ChangesDiff, { kind: 'text' }>; split: boolean; wrap: boolean } & PropsLocale<typeof NS>): ReactNode {
  const note = noteOf(diff)
  return (
    <DiffHunks
      path={diff.path}
      hunks={diff.hunks}
      split={split}
      wrap={wrap}
      {...note === undefined ? {} : { note: t(note) }}
      coarse={diff.coarse}
      labels={{ coarse: t('diff.coarse'), truncated: count => t('diff.truncated', { count }) }}
    />
  )
}
