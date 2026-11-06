/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
import { memo, useCallback, useRef, useState, type ReactElement } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChatFlowSlotProps, RetractMessageResult } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'
import { RunningStatus } from './RunningStatus.tsx'

/** A local submission echo, or a Host-pending steering item without a local submission. */
type PendingInput = ChatFlowSlotProps['pendingInputs'][number]

/** Whether the echo is a local submission rather than a Host-pending steering item. */
function isLocalSubmission(item: PendingInput): item is PendingSubmission {
  return 'requestId' in item
}

/** Whether the echo is a local submission that opens a new Turn. */
function isTranscriptEcho(item: PendingInput): boolean {
  return isLocalSubmission(item) && item.placement === 'transcript'
}

/** A retract outcome the flow reports as one transient banner over the conversation. */
interface MessageActionNotice {
  /** Remounts the banner so a repeated outcome restarts its hold and fade. */
  readonly key: number
  readonly text: string
  readonly tone: 'success' | 'failure'
}

/**
 * State one retract failure reason in plain language.
 * @param reason - the structured reason the Host returned.
 * @param t - Chat locale seat.
 * @returns the localized failure sentence.
 */
function retractFailureText(
  reason: Extract<RetractMessageResult, { ok: false }>['reason'],
  t: ChatFlowSlotProps['t'],
): string {
  switch (reason) {
    case 'busy': return t('message.retract.failed.busy')
    case 'unavailable': return t('message.retract.failed.unavailable')
    case 'failed': return t('message.retract.failed')
    default: return assertNever(reason)
  }
}

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, pendingInputs, lastInputTurn, deferCollapse,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation, useConnectionState,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, retractMessage, editMessage, focusComposer,
  loadImage,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const running = useSession(snapshot => snapshot.running)
  const disconnected = useConnectionState(state => state === 'disconnected' || state === 'connecting')
  // Message actions explain only a lost connection; `connecting` still counts
  // as the paused running clock above but not as a reason the surface is down.
  const offline = useConnectionState(state => state === 'disconnected')
  const latestTurnAnchor = useChat(snapshot => snapshot.navigation.items().at(-1)?.anchorKey)
  const runningStartTime = useChatNode(latestTurnAnchor ?? '', (node) => {
    const location = node?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.status === 'open' ? location.turn.start?.time : undefined
      : undefined
  })
  const latestTurnOpen = useChatNode(latestTurnAnchor ?? '', (node) => {
    const location = node?.location
    return (location?.kind === 'turn' || location?.kind === 'step') && location.turn.status === 'open'
  })
  const holding = !running && latestTurnOpen
  // The banner outlives the row that reports the outcome: retracting removes
  // that row, so the notice belongs to the flow above it.
  const [notice, setNotice] = useState<MessageActionNotice | null>(null)
  const noticeKey = useRef(0)
  // One retraction per message at a time: a repeated click during the request
  // joins it instead of racing a second outcome banner past the first.
  const retractInFlight = useRef(new Map<number, Promise<RetractMessageResult>>())
  const showNotice = useCallback((outcome: Omit<MessageActionNotice, 'key'>) => {
    noticeKey.current += 1
    setNotice({ ...outcome, key: noticeKey.current })
  }, [])
  const retract = useCallback((seq: number): Promise<RetractMessageResult> => {
    const inFlight = retractInFlight.current.get(seq)
    if (inFlight !== undefined) return inFlight
    const request = (async (): Promise<RetractMessageResult> => {
      const result = await retractMessage(seq)
      if (result.ok) {
        showNotice({ text: t('message.retract.done'), tone: 'success' })
        // The retracted rows are gone; the composer is where the user continues.
        focusComposer()
      } else {
        showNotice({ text: retractFailureText(result.reason, t), tone: 'failure' })
      }
      return result
    })()
    retractInFlight.current.set(seq, request)
    const release = (): void => { retractInFlight.current.delete(seq) }
    void request.then(release, release)
    return request
  }, [retractMessage, focusComposer, showNotice, t])
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, inspectCall, forkAt, focusComposer,
    retractMessage: retract, editMessage, disconnected: offline, loadImage,
  }
  const rows = entries.map((entry) => {
    switch (entry.kind) {
      case 'node':
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} />
      default:
        return assertNever(entry)
    }
  })
  // Transcript echoes open the running Turn and precede the status; steering
  // and Inbox echoes follow it, so the status stays on the running Turn's tail.
  // The first transcript echo opens the next Turn, whose first claim takes the
  // steering already pending ahead of it before that prompt; those echoes lead
  // the same Turn in claim order.
  const firstTranscript = pendingInputs.findIndex(isTranscriptEcho)
  const leadingRows: ReactElement[] = []
  const openingRows: ReactElement[] = []
  const pendingRows: ReactElement[] = []
  for (const [index, item] of pendingInputs.entries()) {
    const row = isLocalSubmission(item)
      ? <PendingSubmissionBubble key={item.requestId} submission={item}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
      : <PendingSteeringBubble key={item.id} content={item.content}
        loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />
    if (index <= firstTranscript) leadingRows.push(row)
    else if (isTranscriptEcho(item)) openingRows.push(row)
    else pendingRows.push(row)
  }
  const tail = entries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows the echoes that lead its Turn.
  // All rows share this keyed list so inserting the control keeps the echoes mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    rows.splice(rows.length - 1, 0, ...leadingRows.splice(0))
  }
  // Rows enter before the keyed status and echoes after it, so React never moves its DOM node. The
  // running bit and the Turn's end arrive separately: after the bit clears, an open latest Turn keeps
  // the status slot (hidden) until its actions row takes the slot in the same commit.
  return [
    ...rows, ...leadingRows, ...openingRows,
    ...running || holding ? [<RunningStatus key="running" startTime={runningStartTime} paused={disconnected}
      holding={holding} t={t} />] : [],
    ...pendingRows,
    ...notice === null ? [] : [
      <Toast
        key={`message-notice-${String(notice.key)}`}
        text={notice.text}
        {...notice.tone === 'success' ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular size={18} /> }}
        onDone={() => { setNotice(null) }}
      />,
    ],
  ]
})
