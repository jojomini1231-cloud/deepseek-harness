import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const ROOT = '/tmp/dsh-temporary-root'

function controllerAgents(overrides: object = {}) {
  return {
    ensureSession: () => Promise.resolve(),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    createSession: (request: { readonly cwd: string }) => {
      const ctx = currentTemporaryContext
      if (ctx === undefined) throw new Error('temporary fixture context was not created')
      const session = ctx.sessions.create(requestSessionId ?? SessionId('session-minted'), {
        meta: { cwd: request.cwd },
      })
      return Promise.resolve({
        agent: { id: session.id, session, status: 'idle', ctx } as Agent,
        agentPreset: undefined,
      })
    },
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
    ...overrides,
  } as never
}

let currentTemporaryContext: Context | undefined
let requestSessionId: SessionId | undefined

/** A not-found point query, which is what an id with no stored Session reports. */
function notFound(): never {
  throw new SessionQueryError('not found', 'SESSION_QUERY_SESSION_NOT_FOUND')
}

/** An observation lease carrying one stored cwd, released by the create path. */
function lease(cwd: string): { header: { cwd: string }; [Symbol.dispose]: () => void } {
  return { header: { cwd }, [Symbol.dispose]: () => {} }
}

/**
 * A Host context whose Workspace controller resolves a fixed temporary root,
 * so the create path never reaches the native Documents lookup. The registry
 * and the point query are supplied once here; a test that needs a different
 * behavior passes it as an override rather than re-providing the service.
 */
async function temporaryContext(overrides: {
  registry?: object
  observe?: () => unknown
} = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  ctx.provide('workspaceRegistry', {
    get: () => undefined,
    list: () => [],
    markTemporarySession: () => Promise.resolve(),
    ...overrides.registry,
  } as never)
  ctx.provide('workspaceController', {
    temporaryRoot: () => Promise.resolve(ROOT),
  } as never)
  vi.spyOn(ctx.get('sessionQuery')!, 'observeSession').mockImplementation((overrides.observe ?? notFound) as never)
  currentTemporaryContext = ctx
  return ctx
}

describe('temporary Session creation', () => {
  it('derives the cwd from the temporary root and records the classification', async () => {
    const marked: string[] = []
    const ctx = await temporaryContext({
      registry: { markTemporarySession: (id: string) => { marked.push(id); return Promise.resolve() } },
    })
    const ensureSession = vi.fn((sessionId: SessionId, cwd: string) => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd } })
      return Promise.resolve({ id: sessionId, session } as Agent)
    })
    requestSessionId = SessionId('temp-1')
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    const created = await controller.create({ sessionId: requestSessionId, temporary: true })

    expect(created.sessionId).toBe('temp-1')
    expect(marked).toEqual(['temp-1'])
  })

  it('refuses a temporary request that also names a Workspace or a cwd', async () => {
    const ctx = await temporaryContext()
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default-workspace')

    await expect(controller.create({ temporary: true, cwd: '/somewhere' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.create({ temporary: true, workspaceId: 'workspace-1' as WorkspaceId }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('refuses a session id that is not a usable directory name', async () => {
    const ctx = await temporaryContext()
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default-workspace')

    for (const id of ['', '.', '..', 'nested/leaf', 'nested\\leaf']) {
      await expect(controller.create({ sessionId: SessionId(id), temporary: true }))
        .rejects.toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('reports a failed classification write instead of silently keeping an unclassified Session', async () => {
    const ctx = await temporaryContext({
      registry: { markTemporarySession: () => Promise.reject(new Error('storage blip')) },
    })
    const sessionId = SessionId('temp-fail')
    requestSessionId = sessionId
    const ensureSession = vi.fn(() => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: join(ROOT, 'temp-fail') } })
      return Promise.resolve({ id: sessionId, session } as Agent)
    })
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    await expect(controller.create({ sessionId, temporary: true }))
      .rejects.toMatchObject({ code: 'session/temporary-mark-failed' })
  })

  it('refuses to reclassify an existing Session whose stored cwd is outside the temporary root', async () => {
    const ctx = await temporaryContext({
      observe: () => lease('/some/workspace'),
    })
    const ensureSession = vi.fn()
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    await expect(controller.create({ sessionId: SessionId('ordinary-1'), temporary: true }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(ensureSession).not.toHaveBeenCalled()
  })

  it('adopts an existing Session whose stored cwd is already under the temporary root', async () => {
    const sessionId = SessionId('temp-existing')
    requestSessionId = sessionId
    const stored = join(ROOT, 'temp-existing')
    const ctx = await temporaryContext({ observe: () => lease(stored) })
    const ensureSession = vi.fn(() => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: stored } })
      return Promise.resolve({ id: sessionId, session } as Agent)
    })
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    const created = await controller.create({ sessionId, temporary: true })

    expect(created.sessionId).toBe(sessionId)
  })

  it('never classifies an adopted Session as temporary', async () => {
    // The temporary set is the sole authorization for permanent deletion, so an
    // adopting request must not be able to add an existing Session to it — an
    // ordinary Session created directly under the temporary root is exactly the
    // shape that would otherwise become deletable by asking.
    const sessionId = SessionId('adopted-not-mine')
    requestSessionId = sessionId
    const stored = join(ROOT, 'adopted-not-mine')
    const marked: string[] = []
    const ctx = await temporaryContext({
      observe: () => lease(stored),
      registry: { markTemporarySession: (id: string) => { marked.push(id); return Promise.resolve() } },
    })
    const ensureSession = vi.fn(() => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: stored } })
      return Promise.resolve({ id: sessionId, session } as Agent)
    })
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    await expect(controller.create({ sessionId, temporary: true })).resolves.toMatchObject({ sessionId })

    expect(marked).toEqual([])
  })
})

describe('Workspace attachment after creation', () => {
  it('attaches the Session to a named Workspace', async () => {
    const sessionId = SessionId('attached-1')
    requestSessionId = sessionId
    const attached: string[] = []
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      path: '/some/workspace',
      attachSession: (id: SessionId) => { attached.push(id); return Promise.resolve() },
    } satisfies Pick<Workspace, 'id' | 'path' | 'attachSession'>
    const ctx = await temporaryContext({
      registry: { get: () => workspace, list: () => [workspace] },
    })
    const ensureSession = vi.fn(() => {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: workspace.path } })
      return Promise.resolve({ id: sessionId, session } as Agent)
    })
    const controller = new SessionCommandController(ctx, controllerAgents({ ensureSession }), '/default-workspace')

    await controller.create({ sessionId, workspaceId: workspace.id })

    expect(attached).toEqual([sessionId])
  })
})
