/**
 * Conversation retraction projection: a `conversation-rewind` marker removes
 * every row from its target through itself, an edited message arrives as a
 * normal append, and the Turn that now ends the conversation regains its
 * footer. Compaction checkpoints stay model-only.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionEventLikeEntry, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { developerMessageDefinition, messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { processEvidenceDefinition, turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import {
  isConversationRewindSource, messageSourceKind, retractionTarget,
} from '../src/client/conversation-nodes/surface-rewrite.ts'
import {
  editAccepted, focusComposer, retractOutcome, retractRefusalReason,
} from '../src/client/model/surface-actions.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  messageDefinition,
  developerMessageDefinition,
  assistantDefinition,
  turnProcessDefinition,
  processEvidenceDefinition,
  turnTailDefinition,
]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as SessionEvent,
  }
}

interface TurnInput {
  readonly startSeq: number
  readonly turn: number
  readonly prompt: string
  readonly answer: string
}

/** One completed Turn: start, step, prompt, answer, end. */
function turnEntries({ startSeq, turn, prompt, answer }: TurnInput): SessionLiveEventEntry[] {
  return [
    at(startSeq, 'turn/start', { turn }),
    at(startSeq + 1, 'step/start', { turn, step: 1 }),
    at(startSeq + 2, 'user/message', {
      id: `user-${turn}`,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' }),
    at(startSeq + 3, 'assistant/message', {
      turn,
      step: 1,
      message: {
        id: `assistant-${turn}`,
        role: 'assistant',
        content: [{ type: 'text', text: answer }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: [],
    }, { surfaceOp: 'append' }),
    at(startSeq + 4, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

/** Sequence of a Turn's prompt event, mirroring `turnEntries`. */
function promptSeq(startSeq: number): number {
  return startSeq + 2
}

/** Sequence of a Turn's answer event, mirroring `turnEntries`. */
function answerSeq(startSeq: number): number {
  return startSeq + 3
}

/**
 * Retraction marker. Both the retract and the edit flow record one; the Host
 * may attach a replace surfaceOp or append, and Chat hides the same interval.
 */
function rewindMarker(
  seq: number,
  targetSeq: number | undefined,
  surface: 'append' | 'replace' = 'append',
): SessionLiveEventEntry {
  return at(seq, 'developer/message', {
    message: {
      id: `rewind-${seq}`,
      role: 'developer',
      content: [],
      source: targetSeq === undefined
        ? { kind: 'conversation-rewind' }
        : { kind: 'conversation-rewind', targetSeq },
    },
  }, surface === 'replace' && targetSeq !== undefined
    ? { surfaceOp: { op: 'replace', startSeq: targetSeq, endSeq: seq - 1 }, sourceEventSeqs: [targetSeq] }
    : { surfaceOp: 'append' })
}

/** Ordinary developer history beside the marker, using the shared input lifecycle. */
function developerNotice(seq: number): SessionLiveEventEntry {
  return at(seq, 'developer/message', {
    message: {
      id: `developer-${seq}`,
      role: 'developer',
      content: [],
      source: { kind: 'tool-registry' },
    },
  }, { surfaceOp: 'append' })
}

/** Compaction checkpoint: a model-only replacement that must not hide Chat rows. */
function compactCheckpoint(seq: number, startSeq: number, endSeq: number): SessionLiveEventEntry {
  return at(seq, 'user/message', {
    id: `checkpoint-${seq}`,
    role: 'user',
    content: [{ type: 'text', text: 'compact summary' }],
    source: { kind: 'compact-checkpoint', compactionId: 'compaction-1' },
  }, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: [startSeq, endSeq],
  })
}

function assembler(entries: readonly SessionEventLikeEntry[] = []): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, false)
  value.activateTarget('chat')
  return value
}

function snapshot(value: ConversationNodeAssembler): ChatSnapshot {
  const current = value.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

function appendAll(value: ConversationNodeAssembler, entries: readonly SessionLiveEventEntry[]): ChatSnapshot {
  for (const entry of entries) {
    value.append(entry)
    value.flush()
  }
  return snapshot(value)
}

function nodes(value: ChatSnapshot): ChatNode[] {
  return value.nodes.values().map(node => node as ChatNode)
}

function visible(value: ChatSnapshot): ChatNode[] {
  return value.order.flatMap((key) => {
    const node = value.nodes.get(key) as ChatNode | undefined
    return node === undefined ? [] : [node]
  })
}

function turnOf(node: ChatNode): number | undefined {
  const location = node.location
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
}

function userNode(value: ChatSnapshot, seq: number): ChatNode | undefined {
  return nodes(value).find(node => node.kind === 'user' && node.data.seq === seq)
}

function markerNodes(value: ChatSnapshot): ChatNode[] {
  return nodes(value).filter(node => node.kind === 'context' && isConversationRewindSource(node.data.source))
}

function turnTail(value: ChatSnapshot, turn: number): ChatNode | undefined {
  return visible(value).find(node => node.kind === 'turn-tail' && node.data.turn === turn)
}

/** Four completed Turns covering sequence anchors 0..19. */
function fourTurns(): SessionLiveEventEntry[] {
  return [
    ...turnEntries({ startSeq: 0, turn: 1, prompt: 'first prompt', answer: 'first answer' }),
    ...turnEntries({ startSeq: 5, turn: 2, prompt: 'second prompt', answer: 'second answer' }),
    ...turnEntries({ startSeq: 10, turn: 3, prompt: 'third prompt', answer: 'third answer' }),
    ...turnEntries({ startSeq: 15, turn: 4, prompt: 'fourth prompt', answer: 'fourth answer' }),
  ]
}

describe('conversation retraction projection', () => {
  it('hides the target interval, its marker, and the retracted Turn shell', () => {
    const value = assembler(fourTurns())
    expect(snapshot(value).latestTurn).toBe(4)
    expect(snapshot(value).retractedTurns.size).toBe(0)

    const current = appendAll(value, [rewindMarker(20, promptSeq(15), 'replace')])

    // Every fourth-Turn row, its process control, and its footer are hidden.
    const fourthTurn = nodes(current).filter(node => turnOf(node) === 4)
    expect(fourthTurn.length).toBeGreaterThan(0)
    expect(fourthTurn.every(node => node.visibility === 'hidden' && node.surfaceHidden === true)).toBe(true)
    expect(visible(current).some(node => turnOf(node) === 4)).toBe(false)
    expect(current.order).not.toContain(userNode(current, promptSeq(15))?.key)

    // The marker never renders and records the retracted target.
    const markers = markerNodes(current)
    expect(markers).toHaveLength(1)
    expect(markers[0]?.visibility).toBe('hidden')
    expect(current.order).not.toContain(markers[0]?.key)
    expect(markers[0]?.retraction).toEqual({ targetSeq: promptSeq(15) })

    // The compatibility statistics fallback drops retracted Assistant rows.
    expect(current.legacy.nodes.some(node => node.seq === answerSeq(15))).toBe(false)
    expect(current.legacy.nodes.some(node => node.seq === answerSeq(5))).toBe(true)

    // The third Turn regains the tail actions and the latest-exchange membership.
    const tail = turnTail(current, 3)
    expect(tail).toBeDefined()
    expect(tail?.data).toMatchObject({ branchUnavailable: false, closing: { finalNode: { seq: answerSeq(10) } } })
    expect(current.order.at(-1)).toBe(tail?.key)
    expect(current.latestTurn).toBe(3)
    expect(current.navigation.items().map(item => item.turn)).toEqual([1, 2, 3])
    // The Turn outline still names Turn 4, so the rail drops its mark explicitly.
    expect(current.retractedTurns).toEqual(new Set([4]))
    const thirdPrompt = userNode(current, promptSeq(10))
    expect(thirdPrompt?.visibility).toBe('visible')
    expect(current.nodes.bottomSource(thirdPrompt?.key ?? '').getSnapshot()).toBe(true)
  })

  it('hides the same interval whether the marker replaced a range or appended', () => {
    const appended = assembler(fourTurns())
    const replaced = assembler(fourTurns())

    const appendedCurrent = appendAll(appended, [rewindMarker(20, promptSeq(15), 'append')])
    const replacedCurrent = appendAll(replaced, [rewindMarker(20, promptSeq(15), 'replace')])

    expect(replacedCurrent.order).toEqual(appendedCurrent.order)
    expect(replacedCurrent.latestTurn).toBe(appendedCurrent.latestTurn)
    expect(replacedCurrent.latestTurn).toBe(3)
    expect(visible(replacedCurrent).map(node => node.key)).toEqual(visible(appendedCurrent).map(node => node.key))
  })

  it('hides a Turn whose only remaining rows are shells anchored before the target', () => {
    const entries = [
      ...fourTurns(),
      // A Turn with no Assistant row: its process control anchors at turn/start
      // and its footer at turn/end, both outside [target..marker].
      at(20, 'turn/start', { turn: 5 }),
      at(21, 'step/start', { turn: 5, step: 1 }),
      at(22, 'user/message', {
        id: 'user-5',
        role: 'user',
        content: [{ type: 'text', text: 'fifth prompt' }],
        source: { kind: 'user' },
      }, { surfaceOp: 'append' }),
      at(23, 'turn/end', { turn: 5, reason: { kind: 'interrupted' } }),
    ]
    const value = assembler(entries)
    const synthetic = nodes(snapshot(value)).filter(node => turnOf(node) === 5
      && (node.kind === 'turn-process' || node.kind === 'turn-tail'))
    expect(synthetic.length).toBeGreaterThan(0)
    expect(synthetic.some(node => node.anchorSeq < 22)).toBe(true)

    const current = appendAll(value, [rewindMarker(24, 22)])

    expect(nodes(current).filter(node => turnOf(node) === 5).every(node => node.visibility === 'hidden')).toBe(true)
    expect(current.latestTurn).toBe(4)
    expect(current.order.at(-1)).toBe(turnTail(current, 4)?.key)
  })

  it('renders an edited message appended after the marker as an ordinary user row', () => {
    const value = assembler(fourTurns())
    const editTurn = 5
    // Host order for an edit: the marker, then the replacement prompt as the
    // first ordinary message of a new Turn.
    const current = appendAll(value, [
      rewindMarker(20, promptSeq(15)),
      ...turnEntries({ startSeq: 21, turn: editTurn, prompt: 'rewritten fourth prompt', answer: 'rewritten answer' }),
    ])

    const edited = userNode(current, promptSeq(21))
    expect(edited).toBeDefined()
    expect(edited?.visibility).toBe('visible')
    expect(current.order).toContain(edited?.key)
    expect(edited?.data).toMatchObject({
      content: [{ type: 'text', text: 'rewritten fourth prompt' }],
      source: { kind: 'user' },
    })
    expect(userNode(current, promptSeq(15))?.visibility).toBe('hidden')
    expect(current.order.at(-1)).toBe(turnTail(current, editTurn)?.key)
    expect(current.latestTurn).toBe(editTurn)
    expect(current.navigation.items().map(item => item.turn)).toEqual([1, 2, 3, editTurn])
    // The edit hides the retracted Turn completely and places its replacement
    // in the new Turn, so only the retracted Turn leaves the rail.
    expect(current.retractedTurns).toEqual(new Set([4]))
  })

  it('breaks at the chosen message even when compaction kept a model summary', () => {
    const value = assembler([
      ...fourTurns(),
      compactCheckpoint(20, promptSeq(0), answerSeq(5)),
    ])
    // The reader retracts the second prompt, which the checkpoint already
    // replaced in the model surface; the transcript still breaks there.
    const current = appendAll(value, [rewindMarker(21, promptSeq(5))])

    expect(visible(current).filter(node => node.kind === 'user').map(node => node.data.seq)).toEqual([promptSeq(0)])
    for (const turn of [2, 3, 4]) {
      expect(nodes(current).filter(node => turnOf(node) === turn).every(node => node.visibility === 'hidden')).toBe(true)
    }
    expect(current.navigation.items().map(item => item.turn)).toEqual([1])
    expect(current.latestTurn).toBe(1)
    expect(current.retractedTurns).toEqual(new Set([2, 3, 4]))
  })

  it('stacks retractions so a later marker also hides an earlier one', () => {
    const value = assembler(fourTurns())
    const first = appendAll(value, [rewindMarker(20, promptSeq(10))])
    expect(first.latestTurn).toBe(2)

    // The second interval starts later and ends past the first marker.
    const second = appendAll(value, [rewindMarker(21, promptSeq(15))])

    expect(second.latestTurn).toBe(2)
    expect(second.navigation.items().map(item => item.turn)).toEqual([1, 2])
    expect(second.order.at(-1)).toBe(turnTail(second, 2)?.key)
    const markers = markerNodes(second)
    expect(markers).toHaveLength(2)
    expect(markers.every(node => node.visibility === 'hidden' && !second.order.includes(node.key))).toBe(true)
    for (const seq of [promptSeq(10), answerSeq(10), promptSeq(15), answerSeq(15)]) {
      const hidden = nodes(second).filter(node => (node.kind === 'user' && node.data.seq === seq)
        || (node.kind === 'assistant-step' && node.data.finalNode?.seq === seq))
      expect(hidden.length).toBeGreaterThan(0)
      expect(hidden.every(node => node.visibility === 'hidden' && node.surfaceHidden === true)).toBe(true)
    }
  })

  it('keeps a compaction checkpoint model-only without hiding Chat rows', () => {
    const value = assembler([...fourTurns(), compactCheckpoint(20, promptSeq(0), answerSeq(5))])
    const current = snapshot(value)

    // No row for the checkpoint, and nothing left the transcript.
    expect(nodes(current).some(node => node.kind === 'context' && messageSourceKind(node.data.source) === 'compact-checkpoint')).toBe(false)
    expect(nodes(current).filter(node => node.surfaceHidden === true)).toHaveLength(0)
    expect(current.navigation.items().map(item => item.turn)).toEqual([1, 2, 3, 4])
    expect(current.latestTurn).toBe(4)
    expect(visible(current).filter(node => node.kind === 'user')).toHaveLength(4)
  })

  it('hides every loaded row when the retracted target precedes the loaded window', () => {
    const all = fourTurns()
    const current = snapshot(assembler([...all.slice(10, 15), rewindMarker(20, promptSeq(5))]))

    expect(current.order).toEqual([])
    expect(current.latestTurn).toBeUndefined()
    expect(current.navigation.items()).toEqual([])
  })

  it('hides rows paged in after the retraction when they fall inside its interval', () => {
    const all = fourTurns()
    // The loaded window starts at Turn 3 plus the marker retracting the second
    // prompt, so the interval's earlier rows are still unloaded.
    const value = assembler([...all.slice(10, 15), rewindMarker(20, promptSeq(5))])
    expect(snapshot(value).order).toEqual([])

    value.prepend(all.slice(5, 10), true)
    value.flush()

    const current = snapshot(value)
    expect(current.order).toEqual([])
    expect(current.latestTurn).toBeUndefined()
    expect(nodes(current).filter(node => node.surfaceHidden === true).length).toBeGreaterThan(0)
  })

  it('keeps a marker without a usable target from hiding anything else', () => {
    const value = assembler(fourTurns())
    const current = appendAll(value, [rewindMarker(20, undefined), developerNotice(21)])

    const markers = markerNodes(current)
    expect(markers).toHaveLength(1)
    expect(markers[0]?.visibility).toBe('hidden')
    expect(markers[0]?.retraction).toBeUndefined()
    expect(nodes(current).filter(node => node.surfaceHidden === true)).toHaveLength(0)
    expect(current.latestTurn).toBe(4)
    expect(current.navigation.items().map(item => item.turn)).toEqual([1, 2, 3, 4])
  })
})

describe('surface rewrite helpers', () => {
  it('reads only string source kinds from an opaque message source', () => {
    expect(messageSourceKind({ kind: 'user' })).toBe('user')
    expect(messageSourceKind({ kind: 7 })).toBeNull()
    expect(messageSourceKind({})).toBeNull()
    expect(messageSourceKind(null)).toBeNull()
    expect(messageSourceKind('user')).toBeNull()
  })

  it('reads the retraction target only from a well-formed rewind source', () => {
    expect(retractionTarget({ kind: 'conversation-rewind', targetSeq: 7 })).toBe(7)
    expect(retractionTarget({ kind: 'conversation-rewind' })).toBeUndefined()
    expect(retractionTarget({ kind: 'conversation-rewind', targetSeq: -1 })).toBeUndefined()
    expect(retractionTarget({ kind: 'conversation-rewind', targetSeq: 1.5 })).toBeUndefined()
    expect(retractionTarget({ kind: 'conversation-rewind', targetSeq: '7' })).toBeUndefined()
    expect(retractionTarget({ kind: 'user', targetSeq: 7 })).toBeUndefined()
  })

  it('maps only the busy and unavailable codes to actionable reasons', () => {
    expect(retractRefusalReason('session/busy')).toBe('busy')
    expect(retractRefusalReason('session/rewind-unavailable')).toBe('unavailable')
    expect(retractRefusalReason('session/not-found')).toBe('failed')
    expect(retractRefusalReason('transport')).toBe('failed')
  })

  it('reduces Session command results to the row outcomes', () => {
    const accepted = { ok: true as const, value: { seq: SessionSeq(3) } }
    expect(retractOutcome(accepted)).toEqual({ ok: true })
    expect(editAccepted(accepted)).toBe(true)
    expect(retractOutcome({ ok: false, error: new RemoteError('session/busy', 'busy', { sessionId: 'session-1' as SessionId }) }))
      .toEqual({ ok: false, reason: 'busy' })
    expect(retractOutcome({ ok: false, error: new RemoteError('session/rewind-unavailable', 'gone', { sessionId: 'session-1' as SessionId, targetSeq: 4 }) }))
      .toEqual({ ok: false, reason: 'unavailable' })
    expect(retractOutcome({ ok: false, error: new RemoteError('gateway/internal', 'boom', {}) }))
      .toEqual({ ok: false, reason: 'failed' })
    expect(retractOutcome(null)).toEqual({ ok: false, reason: 'failed' })
    expect(editAccepted({ ok: false, error: new RemoteError('session/edit-empty', 'empty', {}) })).toBe(false)
    expect(editAccepted(null)).toBe(false)
  })

  it('focuses the Session composer only when the Conversation service is mounted', () => {
    const focus = vi.fn()
    const forComposer = vi.fn(() => ({ focus }))
    focusComposer({ input: { for: forComposer } }, undefined as never)
    expect(forComposer).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    focusComposer(undefined, undefined as never)
    expect(forComposer).toHaveBeenCalledOnce()
  })
})
