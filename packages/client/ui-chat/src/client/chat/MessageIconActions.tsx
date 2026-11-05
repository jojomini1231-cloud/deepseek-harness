// Shared IconActions chrome for user and assistant messages: copy live,
// optional message retract/edit, optional branch wiring, and an optional
// date-aware clock.

import { useId, type ReactNode, type Ref } from 'react'
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular,
  IconRewindOutlineRegular, Tooltip, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

/** Why the message actions stay visible but inert. */
export type MessageActionsUnavailable = 'running' | 'disconnected'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Retract this message and everything after it; omission hides the action. */
  onRetract?: (() => void) | undefined
  /** Open this message's inline editor; omission hides the action. */
  onEdit?: (() => void) | undefined
  /**
   * Why retract and edit stay visible but inert; `running` and `disconnected`
   * each explain themselves in place.
   */
  messageActionsUnavailable?: MessageActionsUnavailable | undefined
  /** Ref to the edit action, so a closed editor can return focus to it. */
  editActionRef?: Ref<HTMLButtonElement> | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * branch control at the end of the icon cluster.
   */
  usageAction?: ReactNode
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * One icon action that stays hoverable and focusable while unavailable so its
 * Tooltip can explain why; a native disabled button delivers neither event.
 * @param props.tooltip - label the Tooltip shows and the hidden reason states.
 * @param props.label - accessible name that stays the action's own label.
 * @param props.reasonId - id of the hidden reason element for this action.
 * @param props.unavailable - disables activation without taking focus away.
 * @param props.onActivate - action invoked while available.
 * @param props.icon - decorative glyph.
 * @param props.buttonRef - native ref handed to the owning renderer.
 * @returns the button plus its hidden reason when unavailable.
 */
function MessageActionButton({ tooltip, label, reasonId, unavailable, onActivate, icon, buttonRef }: {
  tooltip: string
  label: string
  reasonId: string
  unavailable: boolean
  onActivate: () => void
  icon: ReactNode
  buttonRef?: Ref<HTMLButtonElement> | undefined
}) {
  return (
    <>
      <Tooltip label={tooltip} side="bottom" openOnClick={unavailable}>
        <button
          ref={buttonRef}
          type="button"
          className={css.action}
          aria-label={label}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? reasonId : undefined}
          data-unavailable={unavailable || undefined}
          onClick={unavailable ? undefined : onActivate}
        >
          {icon}
        </button>
      </Tooltip>
      {unavailable && <span id={reasonId} className={css.visuallyHidden}>{tooltip}</span>}
    </>
  )
}

/**
 * Copy / retract / edit / branch (/ clock) IconActions row shared by user and
 * assistant chrome.
 * @param props - Copy text, event time, clock side, message and branch callbacks, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, time, clock, onBranch, branchUnavailable = false,
  onRetract, onEdit, messageActionsUnavailable, editActionRef, className,
  extraActions, usageAction, t,
}: MessageIconActionsProps) {
  const day = useCalendarDay()
  const reasonId = useId()
  const retractReasonId = useId()
  const editReasonId = useId()
  const unavailable = messageActionsUnavailable !== undefined
  const disconnected = messageActionsUnavailable === 'disconnected'
  const { copied, onCopy } = useClipboardCopy(text)
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`} data-clock={clock}>
      {clock === 'start' ? clockEl : null}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
      {onRetract !== undefined && (
        <MessageActionButton
          tooltip={unavailable
            ? disconnected ? t('message.actions.disconnected') : t('message.retract.unavailable')
            : t('message.retract')}
          label={t('message.retract')}
          reasonId={retractReasonId}
          unavailable={unavailable}
          onActivate={onRetract}
          icon={<IconRewindOutlineRegular />}
        />
      )}
      {onEdit !== undefined && (
        <MessageActionButton
          tooltip={unavailable
            ? disconnected ? t('message.actions.disconnected') : t('message.edit.unavailable')
            : t('message.edit')}
          label={t('message.edit')}
          reasonId={editReasonId}
          unavailable={unavailable}
          onActivate={onEdit}
          icon={<IconEditOutlineRegular />}
          buttonRef={editActionRef}
        />
      )}
      {extraActions}
      {onBranch !== undefined && (
        <MessageActionButton
          tooltip={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')}
          label={t('message.branch')}
          reasonId={reasonId}
          unavailable={branchUnavailable}
          onActivate={onBranch}
          icon={<IconBranchOutlineRegular />}
        />
      )}
      {clock === 'end'
        ? <span className={css.endInfo}>{usageAction}{clockEl}</span>
        : usageAction}
    </div>
  )
}
