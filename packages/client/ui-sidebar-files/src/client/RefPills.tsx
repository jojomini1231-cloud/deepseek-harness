/**
 * The ref pills a history row and the commit page both draw: the commit's refs
 * in their ranked order, then a quiet `+n` for the names the cap left out.
 *
 * The two views differ only in geometry, so each call site passes its own
 * classes; the tone rule — the attached branch reads as the highlighted one —
 * stays here so the row and the page cannot disagree about it.
 */
import type { ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { refDisplayName } from './history.ts'
import type { CommitRefPills } from './history.ts'

/** The pills' props: the chosen refs and the classes of the container and each pill label. */
export interface RefPillsProps {
  /** The refs to draw, already ranked and capped. */
  readonly pills: CommitRefPills
  /** The container's class, which positions the pill row. */
  readonly className: string | undefined
  /** A class for each named pill, such as the row's width cap. */
  readonly pillClassName?: string | undefined
  /** A class for the text inside each named pill, which carries the ellipsis. */
  readonly labelClassName?: string | undefined
}

/**
 * Render one commit's ref pills.
 * @param props.pills - the refs to draw.
 * @param props.className - the container's class.
 * @param props.pillClassName - a class for each named pill.
 * @param props.labelClassName - a class for the text inside each pill.
 * @returns the pill row, or nothing when no ref sits on the commit.
 */
export function RefPills({ pills, className, pillClassName, labelClassName }: RefPillsProps): ReactNode {
  if (pills.shown.length === 0) return null
  return (
    <span className={className}>
      {pills.shown.map(ref => (
        <Tag key={`${ref.kind}:${ref.name}`} tone={ref.head === true ? 'info' : 'neutral'} className={pillClassName}>
          {labelClassName === undefined
            ? refDisplayName(ref.name)
            : <span className={labelClassName}>{refDisplayName(ref.name)}</span>}
        </Tag>
      ))}
      {pills.more > 0 && <Tag tone="quiet" className={pillClassName}>{`+${pills.more}`}</Tag>}
    </span>
  )
}
