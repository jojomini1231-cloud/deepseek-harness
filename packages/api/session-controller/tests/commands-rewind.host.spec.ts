/**
 * Conversation rewinds: the durable retraction marker and the edited
 * replacement message. Marker tests drive the composed Session Controller over
 * a registered structural Agent, because a retraction appends no turn; edit
 * tests mount the production loop, because only an admitted turn records the
 * replacement user message.
 */

import { onTestFinished } from 'vitest'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub, mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from './test-remote.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test-compaction': { kind: 'test-compaction' } & ContextFormed
    'test-context': { kind: 'test-context' } & ContextFormed
  }
}

const sid = (id: string): SessionId => id as SessionId

/** One composed Controller over a registered Agent whose activity the test owns. */
async function stubHarness(
  id: string,
  state: { status?: 'idle' | 'running'; pending?: 'next-turn' | 'next-step' } = {},
): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  ctx.agents.setFactory({
    createAgent: () => Promise.reject(new Error('this harness registers its Agent directly')),
    resume: () => Promise.reject(new Error('resume must not run: the Agent is attached')),
  })
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  const inbox = createInboxStub()
  if (state.pending !== undefined) {
    inbox.append(state.pending, createUserMessage({ content: [{ type: 'text', text: 'pending' }], source: { kind: 'user' } }))
  }
  await ctx.agents.register({
    id: session.id,
    session,
    status: state.status ?? 'idle',
    ctx,
    inbox,
  } as Agent)
  return { ctx, session }
}

function remote(ctx: Context) {
  return createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    cwd: '/tmp',
  })
}

/** Append one completed turn and return its user message event. */
function appendTurn(session: Session, turn: number, prompt: string, reply: string): SessionEvent<'user/message'> {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text: reply }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return user
}

/** Replace the current surface range with a compaction-style summary message. */
function appendCheckpoint(session: Session, shadowed: readonly SessionEvent[]): SessionEvent<'user/message'> {
  const first = shadowed[0] as SessionEvent
  const last = shadowed[shadowed.length - 1] as SessionEvent
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'compacted summary' }],
    source: { kind: 'test-compaction' },
  }), {
    surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: last.seq },
    sourceEventSeqs: shadowed.map(event => event.seq),
  })
}

function eventAt(session: Session, seq: number): SessionEvent {
  const event = session.snapshotEvents().find(candidate => candidate.seq === seq)
  if (event === undefined) throw new Error(`missing event at seq ${String(seq)}`)
  return event
}

function surfaceEvents(session: Session): SessionEvent[] {
  return session.surface.nodes.map(seq => eventAt(session, seq))
}

/** The retraction marker recorded by a rewind request. */
function rewindMarker(session: Session, seq: number): SessionEvent<'developer/message'> {
  const event = eventAt(session, seq)
  if (event.type !== 'developer/message') throw new Error(`event at seq ${String(seq)} is not a developer/message`)
  return event
}

describe('session.retract', () => {
  it('replaces the target-through-tail range with an empty retraction marker', async () => {
    const { ctx, session } = await stubHarness('retract-success')
    const first = appendTurn(session, 1, 'first prompt', 'first answer')
    appendTurn(session, 2, 'second prompt', 'second answer')
    const tail = session.surface.nodes[session.surface.nodes.length - 1]
    const shadowed = [...session.surface.nodes.slice(session.surface.nodes.indexOf(first.seq))]

    const response = await (await remote(ctx)).retract({ sessionId: session.id, targetSeq: first.seq })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const marker = rewindMarker(session, response.value.seq)
    expect(marker.data).toMatchObject({
      turn: 2,
      step: 1,
      message: { content: [], source: { kind: 'conversation-rewind', targetSeq: first.seq } },
    })
    // The retracted target itself is inside the replaced range.
    expect(marker.surfaceOp).toEqual({ op: 'replace', startSeq: first.seq, endSeq: tail })
    expect(marker.sourceEventSeqs).toEqual(shadowed)
    // The marker is the only surviving node and derives no model-visible message.
    expect(session.surface.nodes).toEqual([marker.seq])
    expect(session.deriveMessages()).toEqual([])
  })

  it('retains the compaction summary when the target was already shadowed and later nodes follow', async () => {
    const { ctx, session } = await stubHarness('retract-compacted-tail')
    const first = appendTurn(session, 1, 'compacted prompt', 'compacted answer')
    const summary = appendCheckpoint(session, surfaceEvents(session))
    appendTurn(session, 2, 'later prompt', 'later answer')
    const tail = session.surface.nodes[session.surface.nodes.length - 1]
    const shadowed = [...session.surface.nodes.slice(session.surface.nodes.indexOf(summary.seq) + 1)]

    const response = await (await remote(ctx)).retract({ sessionId: session.id, targetSeq: first.seq })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const marker = rewindMarker(session, response.value.seq)
    expect(marker.data.message.source).toMatchObject({ kind: 'conversation-rewind', targetSeq: first.seq })
    expect(marker.surfaceOp).toEqual({ op: 'replace', startSeq: shadowed[0], endSeq: tail })
    expect(marker.sourceEventSeqs).toEqual(shadowed)
    // The compaction summary survives; everything after it is retracted.
    expect(session.surface.nodes).toEqual([summary.seq, marker.seq])
    expect(session.deriveMessages().map(message => message.content)).toEqual([
      [{ type: 'text', text: 'compacted summary' }],
    ])
  })

  it('appends the marker when the target was shadowed and nothing follows the summary', async () => {
    const { ctx, session } = await stubHarness('retract-compacted-empty-tail')
    const first = appendTurn(session, 1, 'compacted prompt', 'compacted answer')
    const summary = appendCheckpoint(session, surfaceEvents(session))

    const response = await (await remote(ctx)).retract({ sessionId: session.id, targetSeq: first.seq })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const marker = rewindMarker(session, response.value.seq)
    expect(marker.surfaceOp).toBe('append')
    expect(marker.sourceEventSeqs).toBeUndefined()
    // The marker still names the target, so clients can hide from it.
    expect(marker.data.message.source).toMatchObject({ kind: 'conversation-rewind', targetSeq: first.seq })
    expect(session.surface.nodes).toEqual([summary.seq, marker.seq])
    // Nothing was replaced, so the retained summary stays the whole model-visible input.
    expect(session.deriveMessages().map(message => message.content)).toEqual([
      [{ type: 'text', text: 'compacted summary' }],
    ])
  })

  it('retracts the first user message down to the system prompt and its marker', async () => {
    const { ctx, session } = await stubHarness('retract-first-message')
    const system = session.append('system/message', {
      turn: 0,
      step: 0,
      message: createSystemMessage('You are the test agent.'),
    }, { surfaceOp: 'append' })
    const first = appendTurn(session, 1, 'first prompt', 'first answer')
    appendTurn(session, 2, 'second prompt', 'second answer')
    const shadowed = [...session.surface.nodes.slice(session.surface.nodes.indexOf(first.seq))]

    const response = await (await remote(ctx)).retract({ sessionId: session.id, targetSeq: first.seq })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const marker = rewindMarker(session, response.value.seq)
    expect(marker.surfaceOp).toEqual({
      op: 'replace',
      startSeq: first.seq,
      endSeq: shadowed[shadowed.length - 1],
    })
    expect(marker.sourceEventSeqs).toEqual(shadowed)
    // The system prompt and the marker are all that remain.
    expect(session.surface.nodes).toEqual([system.seq, marker.seq])
    expect(session.deriveMessages()).toEqual([system.data.message])
  })

  it('records a second retraction whose replaced range contains the earlier marker', async () => {
    const { ctx, session } = await stubHarness('retract-twice')
    const system = session.append('system/message', {
      turn: 0,
      step: 0,
      message: createSystemMessage('You are the test agent.'),
    }, { surfaceOp: 'append' })
    const first = appendTurn(session, 1, 'first prompt', 'first answer')
    const second = appendTurn(session, 2, 'second prompt', 'second answer')
    const direct = await remote(ctx)
    const beforeFirst = [...session.surface.nodes]

    // The first retraction removes the second turn and leaves its marker at the tail.
    const firstResponse = await direct.retract({ sessionId: session.id, targetSeq: second.seq })
    expect(firstResponse.ok).toBe(true)
    if (!firstResponse.ok) return
    const firstMarker = rewindMarker(session, firstResponse.value.seq)
    expect(session.surface.nodes).toEqual([...beforeFirst.slice(0, 3), firstMarker.seq])

    // A later turn arrives after the first marker.
    appendTurn(session, 3, 'third prompt', 'third answer')
    const shadowed = [...session.surface.nodes.slice(session.surface.nodes.indexOf(first.seq))]
    const tail = session.surface.nodes[session.surface.nodes.length - 1]

    // The second retraction targets a message recorded before the earlier marker.
    const secondResponse = await direct.retract({ sessionId: session.id, targetSeq: first.seq })
    expect(secondResponse.ok).toBe(true)
    if (!secondResponse.ok) return
    const secondMarker = rewindMarker(session, secondResponse.value.seq)
    expect(secondMarker.surfaceOp).toEqual({ op: 'replace', startSeq: first.seq, endSeq: tail })
    expect(secondMarker.sourceEventSeqs).toEqual(shadowed)
    // The citations cover the previous marker, and the new range removes it again.
    expect(secondMarker.sourceEventSeqs).toContain(firstMarker.seq)
    expect(session.surface.nodes).toEqual([system.seq, secondMarker.seq])
    expect(session.deriveMessages()).toEqual([system.data.message])
  })

  it('refuses a running turn or pending input as busy', async () => {
    const running = await stubHarness('retract-running', { status: 'running' })
    const runningTarget = appendTurn(running.session, 1, 'prompt', 'answer')
    await expect((await remote(running.ctx)).retract({ sessionId: running.session.id, targetSeq: runningTarget.seq }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/busy', details: { sessionId: running.session.id } } })

    const queued = await stubHarness('retract-queued', { pending: 'next-turn' })
    const queuedTarget = appendTurn(queued.session, 1, 'prompt', 'answer')
    await expect((await remote(queued.ctx)).retract({ sessionId: queued.session.id, targetSeq: queuedTarget.seq }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/busy' } })
  })

  it('refuses targets that are not a plain user message on the surface', async () => {
    const { ctx, session } = await stubHarness('retract-invalid')
    appendTurn(session, 1, 'prompt', 'answer')
    const turnStart = session.snapshotEvents().find(event => event.type === 'turn/start')
    const assistant = session.snapshotEvents().find(event => event.type === 'assistant/message')
    if (turnStart === undefined || assistant === undefined) throw new Error('missing turn events')
    const nodes = session.surface.nodes
    const direct = await remote(ctx)

    await expect(direct.retract({ sessionId: session.id, targetSeq: turnStart.seq }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/rewind-unavailable', details: { targetSeq: turnStart.seq } } })
    await expect(direct.retract({ sessionId: session.id, targetSeq: assistant.seq }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/rewind-unavailable' } })
    await expect(direct.retract({ sessionId: session.id, targetSeq: session.seq + 5 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/rewind-unavailable' } })
    // Refused requests append nothing.
    expect(session.surface.nodes).toEqual(nodes)
    expect(session.deriveMessages()).toHaveLength(2)
  })

  it('reports an unknown Session as not-found', async () => {
    const { ctx } = await stubHarness('retract-missing')
    await expect((await remote(ctx)).retract({ sessionId: sid('missing-session'), targetSeq: 0 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/not-found' } })
  })
})

describe('session.edit', () => {
  it('records the retraction marker, then appends the edited message with its attachments', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    const harness = await mountAgentLoopTestHarness(ctx)
    const adapter = new MockAdapter([textResponse('first answer'), textResponse('edited answer')])
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] } as never)
    const agent = await harness.create(sid('edit-success'), { provider: 'mock', model: 'mock' })
    const fileBlock = {
      type: 'file' as const,
      attachment: { attachmentId: AttachmentId('sha256:file-1'), name: 'notes.txt', bytes: 12 },
    }
    const imageBlock = {
      type: 'image' as const,
      attachment: {
        attachmentId: AttachmentId('sha256:image-1'),
        mediaType: 'image/png' as const,
        bytes: 68,
        width: 1,
        height: 1,
      },
    }
    const original = createUserMessage({
      content: [fileBlock, imageBlock, { type: 'text', text: 'old text' }],
      source: { kind: 'user' },
    })
    agent.followup(original)
    await agent.whenIdle()
    const target = agent.session.snapshotEvents().find(event =>
      event.type === 'user/message' && event.data.id === original.id)
    if (target?.type !== 'user/message') throw new Error('missing original user message')
    const tail = agent.session.surface.nodes[agent.session.surface.nodes.length - 1]
    const shadowed = [...agent.session.surface.nodes.slice(agent.session.surface.nodes.indexOf(target.seq))]

    // Reference/skill context follows the prompt as its own ordinary message.
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      if (!messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'new text'))) {
        return decision
      }
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: 'reference context' }],
          source: { kind: 'test-context', form: 'notice', summary: 'reference context' },
        })],
      }
    })

    const response = await (await remote(ctx)).edit({ sessionId: agent.id, targetSeq: target.seq, text: 'new text' })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    await agent.whenIdle()

    const edited = eventAt(agent.session, response.value.seq)
    expect(edited.type).toBe('user/message')
    if (edited.type !== 'user/message') return
    expect(edited.data.content).toEqual([fileBlock, imageBlock, { type: 'text', text: 'new text' }])
    expect(edited.data.source).toEqual({ kind: 'user' })
    // The marker, not the message, carries the retraction range.
    expect(edited.surfaceOp).toBe('append')
    const marker = agent.session.snapshotEvents().find(event =>
      event.type === 'developer/message' && event.seq < edited.seq)
    if (marker?.type !== 'developer/message') throw new Error('missing retraction marker')
    expect(marker.data.message.source).toMatchObject({ kind: 'conversation-rewind', targetSeq: target.seq })
    expect(marker.surfaceOp).toEqual({ op: 'replace', startSeq: target.seq, endSeq: tail })
    expect(marker.sourceEventSeqs).toEqual(shadowed)
    // The replacement opens a real turn: its boundary precedes the message.
    const turnStart = agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')
    expect(turnStart?.seq).toBeGreaterThan(marker.seq)
    expect(turnStart?.seq).toBeLessThan(edited.seq)

    const injected = agent.session.snapshotEvents().find(event =>
      event.type === 'user/message' && event.data.source.kind === 'test-context')
    if (injected?.type !== 'user/message') throw new Error('missing injected context message')
    expect(injected.seq).toBeGreaterThan(edited.seq)
    expect(injected.surfaceOp).toBe('append')

    // The next request carries the truncated history: the replacement plus the injected context.
    const request = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(request).toContain('new text')
    expect(request).toContain('reference context')
    expect(request).not.toContain('old text')
    expect(request).not.toContain('first answer')
    expect(agent.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content))
      .toEqual([
        [fileBlock, imageBlock, { type: 'text', text: 'new text' }],
        [{ type: 'text', text: 'reference context' }],
      ])
  })

  it('retracts from after the compaction summary when the target was compacted', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    const harness = await mountAgentLoopTestHarness(ctx)
    const adapter = new MockAdapter([
      textResponse('first answer'), textResponse('second answer'), textResponse('edited answer'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] } as never)
    const agent = await harness.create(sid('edit-compacted'), { provider: 'mock', model: 'mock' })
    const first = createUserMessage({ content: [{ type: 'text', text: 'compacted prompt' }], source: { kind: 'user' } })
    agent.followup(first)
    await agent.whenIdle()
    // The system prompt at surface node 0 is not part of the compacted range.
    const summary = appendCheckpoint(
      agent.session,
      surfaceEvents(agent.session).filter(event => event.type !== 'system/message'),
    )
    const second = createUserMessage({ content: [{ type: 'text', text: 'later prompt' }], source: { kind: 'user' } })
    agent.followup(second)
    await agent.whenIdle()
    const target = agent.session.snapshotEvents().find(event =>
      event.type === 'user/message' && event.data.id === first.id)
    if (target?.type !== 'user/message') throw new Error('missing compacted user message')
    const tail = agent.session.surface.nodes[agent.session.surface.nodes.length - 1]
    const shadowed = [...agent.session.surface.nodes.slice(agent.session.surface.nodes.indexOf(summary.seq) + 1)]

    const response = await (await remote(ctx)).edit({ sessionId: agent.id, targetSeq: target.seq, text: 'edited text' })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    await agent.whenIdle()

    const edited = eventAt(agent.session, response.value.seq)
    expect(edited.type).toBe('user/message')
    if (edited.type !== 'user/message') return
    expect(edited.surfaceOp).toBe('append')
    const marker = agent.session.snapshotEvents().find(event =>
      event.type === 'developer/message' && event.seq < edited.seq)
    if (marker?.type !== 'developer/message') throw new Error('missing retraction marker')
    expect(marker.data.message.source).toMatchObject({ kind: 'conversation-rewind', targetSeq: target.seq })
    expect(marker.surfaceOp).toEqual({ op: 'replace', startSeq: shadowed[0], endSeq: tail })
    expect(marker.sourceEventSeqs).toEqual(shadowed)
    // The summary survives; the edited message and its turn follow it.
    expect(agent.session.surface.nodes).toContain(summary.seq)
    const request = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(request).toContain('compacted summary')
    expect(request).toContain('edited text')
    expect(request).not.toContain('later prompt')
    expect(request).not.toContain('compacted prompt')
  })

  it('refuses empty text, busy Sessions, and non-user targets before recording anything', async () => {
    const { ctx, session } = await stubHarness('edit-invalid')
    const target = appendTurn(session, 1, 'prompt', 'answer')
    const assistant = session.snapshotEvents().find(event => event.type === 'assistant/message')
    if (assistant === undefined) throw new Error('missing assistant message')
    const nodes = session.surface.nodes
    const direct = await remote(ctx)

    await expect(direct.edit({ sessionId: session.id, targetSeq: target.seq, text: '   ' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/edit-empty' } })
    await expect(direct.edit({ sessionId: session.id, targetSeq: assistant.seq, text: 'new text' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/rewind-unavailable' } })
    // Refused requests record no marker.
    expect(session.surface.nodes).toEqual(nodes)

    const busy = await stubHarness('edit-busy', { status: 'running' })
    const busyTarget = appendTurn(busy.session, 1, 'prompt', 'answer')
    await expect((await remote(busy.ctx)).edit({ sessionId: busy.session.id, targetSeq: busyTarget.seq, text: 'new text' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/busy' } })
  })
})
