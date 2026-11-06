/** Complete-log continuation projection, including recovery and publication. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createAssistantMessage, createDeveloperMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SurfaceOp, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import { expect, it, onTestFinished, vi } from 'vitest'

import { continuationProjectionDefinition as definition } from '../src/continuation.ts'
import { paginate } from '../src/history.ts'
import { continuationTurn as turn } from '../../../client/ui-conversation/tests/continuation-fixture.ts'

const failed = (code: string): TurnEndReason => ({ kind: 'error', error: { code, message: code } })
function fold(events: readonly SessionEvent[]) {
  return events.reduce((state, event) => definition.apply(state, event), definition.init())
}
const events = (reason: TurnEndReason) => turn(reason).map(entry => entry.event)
/** The empty `conversation-rewind` marker `session.retract` and `session.edit` record. */
function rewind(seq: number, targetSeq: number, surfaceOp: SurfaceOp = 'append'): SessionEvent<'developer/message'> {
  return { type: 'developer/message', seq: SessionSeq(seq), time: 0, surfaceOp, data: { turn: 1, step: 1,
    message: createDeveloperMessage({ content: [], source: { kind: 'conversation-rewind', targetSeq: SessionSeq(targetSeq) } }),
  } }
}

it.each(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED'])(
  'offers a manual new turn after %s independently of automatic retries', (code) => {
    expect(definition.wire.view(fold(events(failed(code))))).toBe(5)
  },
)
it.each(['AUTH', 'QUOTA', 'ACCOUNT_QUOTA', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'UNKNOWN_MODEL',
  'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'TOOL_ACTIVATION_FAILED', 'MALFORMED_RESPONSE', 'PI_AI_ERROR', 'UNKNOWN'])(
  'leaves %s to its own recovery action', (code) => {
    expect(definition.wire.view(fold(events(failed(code))))).toBeNull()
  },
)
it.each<TurnEndReason>([
  { kind: 'completed' }, { kind: 'max-tokens' }, { kind: 'blocked' },
  { kind: 'interrupted' }, { kind: 'forked' }, { kind: 'aborted', reason: { kind: 'user' } },
])('leaves a $kind turn unchanged', (reason) => {
  expect(definition.wire.view(fold(events(reason)))).toBeNull()
})

it('requires admitted human input and a failed settlement in the last step', () => {
  const base = events(failed('TIMEOUT'))
  expect(fold(base.filter(event => event.type !== 'user/message')).ending).toBeNull()
  expect(fold(base.filter(event => event.type !== 'assistant/attempt')).ending).toBeNull()
  const user = base.find(event => event.type === 'user/message')!
  const replacement: SessionEvent<'user/message'> = { ...user,
    surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(1) },
  }
  expect(fold(base.map(event => event === user ? replacement : event)).ending).toBeNull()
  const injected: SessionEvent<'user/message'> = { ...user, data: createUserMessage({
    content: [{ type: 'text', text: 'mode context' }], source: { kind: 'user-approval' },
  }) }
  expect(fold(base.map(event => event === user ? injected : event)).ending).toBeNull()
  const prefix = base.slice(0, -1)
  const step: SessionEvent<'step/start'> = { type: 'step/start', seq: SessionSeq(5), time: 0, data: { turn: 1, step: 2 } }
  expect(fold([...prefix, step, base.at(-1)!]).ending).toBeNull()
  const success: SessionEvent<'assistant/message'> = { type: 'assistant/message', seq: SessionSeq(5), time: 0,
    surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: createAssistantMessage({
      content: [{ type: 'text', text: 'done' }], source: { provider: 'test', model: 'test' },
    }) },
  }
  expect(fold([...prefix, success, base.at(-1)!]).ending).toBeNull()
})

it('keeps unrelated events and repeated settlements reference-stable', () => {
  const base = events(failed('SERVER'))
  const state = fold(base.slice(0, -1))
  expect(definition.apply(state, base[2]!)).toBe(state)
  expect(definition.apply(state, base[3]!)).toBe(state)
  expect(definition.apply(state, base[4]!)).toBe(state)
  expect(definition.apply(definition.init(), base[1]!)).toBe(definition.init())
  const reset = definition.apply(state, base[1]!)
  expect(reset.failedAttempt).toBe(false)
})

it('restores a checkpoint plus suffix identically to full replay and retires on a new turn', () => {
  const base = events(failed('SERVER'))
  const prefix = fold(base.slice(0, 3))
  const restored = definition.stateSchema.parse(JSON.parse(JSON.stringify(prefix)))
  expect(base.slice(3).reduce((state, event) => definition.apply(state, event), restored)).toEqual(fold(base))
  const ended = fold(base)
  expect(definition.apply(ended, { type: 'turn/start', seq: SessionSeq(6), time: 1, data: { turn: 2 } }).ending).toBeNull()
  expect(definition.wire.viewSchema.parse(ended.ending)).toBe(5)
  expect(() => definition.stateSchema.parse({ ...ended, ending: -1 })).toThrow()
  expect(() => definition.wire.viewSchema.parse('5')).toThrow()
})

it('publishes a complete-log result independently of the visible page and releases registration', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.sessionProjections.register(definition)
  const session = ctx.sessions.create(SessionId('continued'))
  expect(ctx.sessionProjections.snapshot(session).values.conversationContinuation).toBeNull()
  const history: SessionEvent[] = []
  ctx.on('session/event', (_session, event) => { history.push(event) })
  const changed = vi.fn<Parameters<typeof ctx.sessionProjections.onChanged>[0]>()
  ctx.sessionProjections.onChanged(changed)
  session.append('turn/start', { turn: 1 })
  expect(changed).not.toHaveBeenCalled()
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  // A long failed turn exceeds the browser's 500-message page budget.
  for (let index = 0; index < 600; index++) {
    session.append('assistant/message', { turn: 1, step: index + 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: 'progress' }], source: { provider: 'test', model: 'test' } }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: index + 1 })
    session.append('step/start', { turn: 1, step: index + 2 })
  }
  session.append('assistant/attempt', { turn: 1, step: 601, stream: [] })
  const ending = session.append('turn/end', { turn: 1, reason: failed('SERVER') }).seq
  const page = paginate(history, undefined, 500, ending, { minMessages: 50, minTurns: 2 })
  expect(page.hasMore).toBe(true)
  expect(page.events.some(event => event.type === 'turn/start')).toBe(false)
  expect(ctx.sessionProjections.snapshot(session).values.conversationContinuation).toBe(ending)
  expect(changed.mock.calls.map(([, key, value]) => [key, value])).toEqual([['conversationContinuation', null], ['conversationContinuation', ending]])
  expect(ctx.sessionProjections.checkpoint(session).conversationContinuation)
    .toEqual({ ver: 5, seq: ending, val: { admitted: false, failedAttempt: false, ending } })
  session.append('turn/start', { turn: 2 })
  expect(ctx.sessionProjections.snapshot(session).values.conversationContinuation).toBeNull()
  expect(changed).toHaveBeenCalledTimes(3)
  await fiber.dispose()
  expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('conversationContinuation')
})

it('restores valid, absent and outdated checkpoints through the registry', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.sessionProjections.register(definition)
  const session = ctx.sessions.create(SessionId('restored'))
  const log = events(failed('SERVER'))
  const checkpoint = { conversationContinuation: { ver: 5, seq: SessionSeq(2), val: fold(log.slice(0, 3)) } }
  const restore = (rows: typeof checkpoint | Record<string, never>, tail: readonly SessionEvent[], base: number) =>
    ctx.sessionProjections.restore(rows, tail, SessionLogOffset(base), session.header, session.inheritedEventCount)
  expect(restore(checkpoint, log.slice(3), 3).snapshot.values.conversationContinuation).toBe(5)
  expect(restore({}, log, 0).snapshot.values.conversationContinuation).toBe(5)
  const outdated = { conversationContinuation: { ...checkpoint.conversationContinuation, ver: 4 } }
  expect(restore(outdated, log, 0).snapshot.values.conversationContinuation).toBe(5)
  expect(() => restore(outdated, log.slice(3), 3)).toThrow('re-read from seq 0')
  expect(() => restore({}, log.slice(3), 3)).toThrow('re-read from seq 0')
})

it('admits empty retry messages while ignoring empty ordinary and non-empty retry messages', () => {
  const base = events(failed('SERVER'))
  const input = base.find(event => event.type === 'user/message')!
  const empty: SessionEvent<'user/message'> = { ...input, type: 'user/message', data: createUserMessage({
    content: [], source: { kind: 'user' },
  }) }
  expect(fold(base.map(event => event === input ? empty : event)).ending).toBeNull()
  const retry: SessionEvent<'user/message'> = { ...empty, data: createUserMessage({
    content: [], source: { kind: 'retry', rpcId: 'retry' as import('../src/types.ts').SessionRequestId },
  }) }
  const nonEmpty: SessionEvent<'user/message'> = { ...retry, data: { ...retry.data,
    content: [{ type: 'text', text: 'not an empty retry' }],
  } }
  expect(fold(base.map(event => event === input ? nonEmpty : event)).ending).toBeNull()
  const replacement: SessionEvent<'user/message'> = { ...retry,
    surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(1) },
  }
  expect(fold(base.map(event => event === input ? replacement : event)).ending).toBeNull()
  expect(fold(base.map(event => event === input ? retry : event)).ending).toBe(5)
  const admitted = definition.apply(definition.init(), retry)
  expect(definition.apply(admitted, retry)).toBe(admitted)
})

it('withdraws eligibility when a rewind targets the failed turn or an earlier one', () => {
  const failedTurn = events(failed('SERVER'))
  expect(fold([...failedTurn, rewind(6, 2)])).toEqual(definition.init())
  expect(fold([...failedTurn, rewind(6, 2, { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(2) })]))
    .toEqual(definition.init())
  const later = [...events({ kind: 'completed' }), ...turn(failed('SERVER'), 2).map(entry => entry.event)]
  expect(fold(later).ending).toBe(11)
  expect(definition.wire.view(fold([...later, rewind(12, 8)]))).toBeNull()
  expect(definition.wire.view(fold([...later, rewind(12, 2)]))).toBeNull()
  const ineligible = fold(events({ kind: 'completed' }))
  expect(definition.apply(ineligible, rewind(6, 2))).toBe(ineligible)
})

it('keeps eligibility when a rewind targets a message logged after the failed turn', () => {
  const afterFailure: SessionEvent<'user/message'> = { type: 'user/message', seq: SessionSeq(6), time: 0, surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text: 'after the failure' }], source: { kind: 'user' } }) }
  const kept = fold([...events(failed('SERVER')), afterFailure])
  expect(kept.ending).toBe(5)
  expect(definition.apply(kept, rewind(7, 6))).toBe(kept)
})

it.each<TurnEndReason>([failed('TIMEOUT'), { kind: 'completed' }])(
  'lets the $kind turn an edit opens decide continuation', (reason) => {
    const edited = turn(reason, 2).map(({ event }) => ({ ...event, seq: SessionSeq(event.seq + 1) }))
    const withMarker = fold([...events(failed('SERVER')), rewind(6, 2), ...edited])
    expect(withMarker).toEqual(fold([...events(failed('SERVER')), ...edited]))
    expect(withMarker.ending).toBe(reason.kind === 'error' ? 12 : null)
  },
)

it('publishes a rewind withdrawal live and restores it identically from the log', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const handle = await ctx.sessionProjections.register(definition)
  const session = ctx.sessions.create(SessionId('rewound'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const target = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
  session.append('step/end', { turn: 1, step: 1 })
  const ending = session.append('turn/end', { turn: 1, reason: failed('SERVER') }).seq
  const beforeMarker = ctx.sessionProjections.checkpoint(session)
  const changed = vi.fn<Parameters<typeof ctx.sessionProjections.onChanged>[0]>()
  ctx.sessionProjections.onChanged(changed)
  const marker = session.append('developer/message', { turn: 1, step: 1, message: createDeveloperMessage({
    content: [], source: { kind: 'conversation-rewind', targetSeq: target.seq },
  }) }, { surfaceOp: { op: 'replace', startSeq: target.seq, endSeq: target.seq }, sourceEventSeqs: [target.seq] })
  expect(ctx.sessionProjections.snapshot(session).values.conversationContinuation).toBeNull()
  expect(changed.mock.calls).toEqual([[session, 'conversationContinuation', null, marker.seq]])
  const log = session.snapshotEvents()
  expect(fold(log)).toEqual(handle.stateOf(session))
  const restore = (rows: Parameters<typeof ctx.sessionProjections.restore>[0], base: number) => ctx.sessionProjections
    .restore(rows, log.slice(base), SessionLogOffset(base), session.header, session.inheritedEventCount)
    .snapshot.values.conversationContinuation
  expect(restore({}, 0)).toBeNull()
  expect(restore(beforeMarker, ending + 1)).toBeNull()
  expect(restore(ctx.sessionProjections.checkpoint(session), marker.seq + 1)).toBeNull()
  // A version-4 row could keep `ending` past the marker, so restore refolds it from the log.
  const stale = { conversationContinuation: { ver: 4, seq: marker.seq, val: { ...definition.init(), ending } } }
  expect(restore(stale, 0)).toBeNull()
})
