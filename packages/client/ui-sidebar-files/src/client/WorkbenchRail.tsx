/**
 * The workbench's activity rail: a fixed narrow column of icon-only items, one
 * per view container, that selects what the body draws beside it.
 *
 * The rail owns no state. It draws the containers it is given and reports the
 * selected one back; today the workbench has one container, so the array below
 * holds one item and a second one extends both the array and the body.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip, IconFolderOpenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './FilesBody.module.css'

/** One view container the rail can select. */
export interface RailItem {
  /** Stable container id. */
  readonly id: string
  /** The container's icon; the rail never draws text. */
  readonly icon: ReactNode
  /** Locale key naming the container, used for the tooltip and the accessible name. */
  readonly label: 'rail.files'
}

/** The containers this workbench offers, in rail order. */
const RAIL: readonly RailItem[] = [
  { id: 'files', icon: <IconFolderOpenOutlineRegular />, label: 'rail.files' },
]

/** The rail's props: the selected container and the gesture that selects one. */
export interface WorkbenchRailProps {
  /** Id of the container the body is drawing. */
  readonly selected: string
  /** Select a container. */
  readonly onSelect: (id: string) => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * Render the activity rail.
 * @param props - the selected container, the select gesture, and translate.
 * @returns the rail column.
 */
export function WorkbenchRail({ selected, onSelect, t }: WorkbenchRailProps): ReactNode {
  return (
    <div className={css.rail} role="toolbar" aria-orientation="vertical" aria-label={t('rail.aria')} data-files-rail>
      {RAIL.map(item => (
        <Tooltip key={item.id} label={t(item.label)} side="right" delayMs={300}>
          <button
            type="button"
            className={clsx(css.railItem, item.id === selected && css.railItemActive)}
            aria-label={t(item.label)}
            aria-current={item.id === selected ? 'page' : undefined}
            data-files-rail-item={item.id}
            onClick={() => { onSelect(item.id) }}
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
