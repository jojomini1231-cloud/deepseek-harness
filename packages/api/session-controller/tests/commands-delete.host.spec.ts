/**
 * The permanent-deletion Host command: which Sessions it refuses, the order
 * it stops work and removes state in, and what it leaves behind on failure.
 * The command is driven directly over a Host context whose Workspace
 * registry, Workspace controller, and persistence backend are doubles, so
 * each step's observable effect is asserted where it happens.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionCommandController } from '../src/commands.ts'

const ROOT = '/tmp/dsh-temporary-root'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A real directory the deletion is expected to remove. */
async function makeTemporaryDir(sessionId: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  tempDirs.push(base)
  const directory = join(base, sessionId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'artifact.txt'), 'kept while the Session lives')
  return directory
}

/** The `ctx.agents` face the command drives, recording disposal. */
function agentController(overrides: object = {}): { disposeAgent: ReturnType<typeof vi.fn> } {
  return {
    disposeAgent: vi.fn(async () => {}),
    ...overrides,
  }
}

interface DeleteContextOptions {
  readonly temporarySessionIds?: readonly string[]
  readonly temporaryRoot?: string
  readonly sessions?: readonly { readonly id: string; readonly parentSession?: string; readonly origin?: 'subagent' }[]
  /** Stored working directory by Session id; defaults to the minted `<root>/<id>`. */
  readonly cwds?: Readonly<Record<string, string>>
  readonly activity?: readonly SessionActivity[]
  readonly deleteSession?: (id: string, options?: { readonly signal?: AbortSignal }) => Promise<void>
  readonly forgetSession?: (id: string) => Promise<void>
  readonly stopFails?: string
  readonly agents?: object
}

/**
 * A Host context wired for the deletion path: a registry double answering the
 * temporary set and recording the forget, a Workspace controller resolving a
 * fixed temporary root, a Session query listing the corpus, and a persistence
 * double recording the deletion.
 */
function deleteContext(options: DeleteContextOptions = {}) {
  const ctx = new Context()
  const forgotten: string[] = []
  const deleted: string[] = []
  const stopped: string[] = []
  const sessions = options.sessions ?? []
  ctx.provide('workspaceRegistry', {
    temporarySessionIds: options.temporarySessionIds ?? [],
    forgetSession: options.forgetSession ?? ((id: string) => { forgotten.push(id); return Promise.resolve() }),
  } as never)
  ctx.provide('workspaceController', {
    temporaryRoot: () => Promise.resolve(options.temporaryRoot ?? ROOT),
  } as never)
  const root = options.temporaryRoot ?? ROOT
  ctx.provide('sessionQuery', {
    listSessions: () => Promise.resolve(sessions.map(entry => ({
      header: {
        id: entry.id,
        ...(entry.parentSession === undefined ? {} : { parentSession: entry.parentSession }),
        ...(entry.origin === undefined ? {} : { origin: entry.origin }),
      },
    }))),
    // The deletion reads the Session's own stored working directory, so the
    // double answers one for every id: the minted `<root>/<id>` unless the
    // test names a different one.
    observeSession: (id: string) => Promise.resolve({
      header: { cwd: options.cwds?.[id] ?? join(root, id) },
      [Symbol.dispose]() {},
    }),
  } as never)
  ctx.provide('sessionPersistence', {
    delete: options.deleteSession ?? ((id: string) => { deleted.push(id); return Promise.resolve() }),
  } as never)
  ctx.on('workspace/session-activity', async (_request, next): Promise<readonly SessionActivity[]> => {
    const rest = await next()
    return options.activity === undefined || options.activity.length === 0
      ? rest
      : [...options.activity, ...rest]
  })
  ctx.on('workspace/session-stop', ({ sessionId }: { sessionId: string }) => {
    stopped.push(sessionId)
    if (options.stopFails !== undefined) throw new Error(options.stopFails)
  })
  const controller = new SessionCommandController(
    ctx,
    agentController(options.agents) as never,
    '/default-workspace',
  )
  return { ctx, controller, forgotten, deleted, stopped }
}

describe('temporary Session deletion', () => {
  it('deletes the log, the temporary directory, and the classification', async () => {
    const directory = await makeTemporaryDir('temp-1')
    const agents = agentController()
    const h = deleteContext({
      temporarySessionIds: ['temp-1'],
      temporaryRoot: join(directory, '..'),
      agents,
    })

    await expect(h.controller.delete({ sessionId: 'temp-1' as SessionId }))
      .resolves.toEqual({ deleted: true })

    // The Agent is disposed before anything on disk is removed: its write
    // handle would otherwise recreate the artifact the deletion removes.
    expect(agents.disposeAgent).toHaveBeenCalledWith('temp-1')
    expect(h.deleted).toEqual(['temp-1'])
    expect(h.forgotten).toEqual(['temp-1'])
    await expect(readFile(join(directory, 'artifact.txt'), 'utf8')).rejects.toThrow()
  })

  it('refuses a Session outside the temporary set without touching anything', async () => {
    const h = deleteContext({ temporarySessionIds: [] })
    await expect(h.controller.delete({ sessionId: 'ordinary' as SessionId }))
      .rejects.toMatchObject({ code: 'session/not-temporary' })
    expect(h.deleted).toEqual([])
    expect(h.forgotten).toEqual([])
  })

  it('deletes the subagent descendants before the Session that owns them', async () => {
    // A subagent descendant is reachable only through the lineage the deletion
    // removes, and no surface deletes one on its own, so it goes with its root.
    const agents = agentController()
    const h = deleteContext({
      temporarySessionIds: ['parent'],
      sessions: [
        { id: 'parent' },
        { id: 'child', parentSession: 'parent', origin: 'subagent' },
        { id: 'grandchild', parentSession: 'child', origin: 'subagent' },
      ],
      agents,
    })
    await expect(h.controller.delete({ sessionId: 'parent' as SessionId })).resolves.toEqual({ deleted: true })
    // Deepest first, so a failure leaves the root — and with it the temporary
    // classification that makes a retry reachable — in place.
    expect(h.deleted).toEqual(['grandchild', 'child', 'parent'])
    expect(agents.disposeAgent.mock.calls).toEqual([['grandchild'], ['child'], ['parent']])
    expect(h.forgotten).toEqual(['grandchild', 'child', 'parent'])
  })

  it('leaves the temporary root in place when a descendant cannot be removed', async () => {
    const attempts: string[] = []
    const h = deleteContext({
      temporarySessionIds: ['parent'],
      sessions: [
        { id: 'parent' },
        { id: 'child', parentSession: 'parent', origin: 'subagent' },
      ],
      deleteSession: (id: string) => {
        attempts.push(id)
        return id === 'child' ? Promise.reject(new Error('storage offline')) : Promise.resolve()
      },
    })
    await expect(h.controller.delete({ sessionId: 'parent' as SessionId }))
      .rejects.toMatchObject({ code: 'session/delete-failed' })
    expect(attempts).toEqual(['child'])
    expect(h.forgotten).toEqual([])
  })

  it('treats a fork as an independent conversation, not a descendant', async () => {
    // A fork shares the parent field without the subagent origin.
    const h = deleteContext({
      temporarySessionIds: ['source'],
      sessions: [{ id: 'source' }, { id: 'fork', parentSession: 'source' }],
    })
    await expect(h.controller.delete({ sessionId: 'source' as SessionId })).resolves.toEqual({ deleted: true })
  })

  it('refuses running work and reports it, deleting nothing', async () => {
    const h = deleteContext({
      temporarySessionIds: ['busy'],
      activity: [{ kind: 'turn' }],
    })
    await expect(h.controller.delete({ sessionId: 'busy' as SessionId }))
      .rejects.toMatchObject({ code: 'session/active', details: { activity: [{ kind: 'turn' }] } })
    expect(h.deleted).toEqual([])
    expect(h.stopped).toEqual([])
  })

  it('stops the running work first when the request asks for it', async () => {
    const h = deleteContext({
      temporarySessionIds: ['busy'],
      activity: [{ kind: 'job' }],
    })
    await expect(h.controller.delete({ sessionId: 'busy' as SessionId, stopActivity: true }))
      .resolves.toEqual({ deleted: true })
    expect(h.stopped).toEqual(['busy'])
    expect(h.deleted).toEqual(['busy'])
  })

  it('reports a failed deletion without claiming the classification was dropped', async () => {
    const h = deleteContext({
      temporarySessionIds: ['fragile'],
      deleteSession: () => Promise.reject(new Error('storage offline')),
    })
    await expect(h.controller.delete({ sessionId: 'fragile' as SessionId }))
      .rejects.toMatchObject({ code: 'session/delete-failed' })
    expect(h.forgotten).toEqual([])
  })

  it('keeps a failing forget visible instead of reporting a clean deletion', async () => {
    const h = deleteContext({
      temporarySessionIds: ['stubborn'],
      forgetSession: () => Promise.reject(new Error('registry write failed')),
    })
    await expect(h.controller.delete({ sessionId: 'stubborn' as SessionId }))
      .rejects.toMatchObject({ code: 'session/delete-failed' })
  })

  it('removes a directory that is already gone without failing', async () => {
    const directory = await makeTemporaryDir('vanished')
    await rm(directory, { recursive: true, force: true })
    const h = deleteContext({
      temporarySessionIds: ['vanished'],
      temporaryRoot: join(directory, '..'),
    })
    await expect(h.controller.delete({ sessionId: 'vanished' as SessionId })).resolves.toEqual({ deleted: true })
  })

  it('retries a deletion whose log is already gone', async () => {
    // The first attempt removed the log and then failed; the retry finds the
    // log absent, which is the state the step exists to reach, so the deletion
    // converges instead of stranding the Session.
    const directory = await makeTemporaryDir('retried')
    let attempts = 0
    const h = deleteContext({
      temporarySessionIds: ['retried'],
      temporaryRoot: join(directory, '..'),
      deleteSession: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new SessionPersistenceNotFoundError('retried' as SessionId))
          : Promise.resolve()
      },
    })
    await expect(h.controller.delete({ sessionId: 'retried' as SessionId })).resolves.toEqual({ deleted: true })
    expect(h.forgotten).toEqual(['retried'])
  })

  it('leaves a working directory the Session no longer uses', async () => {
    // The leaf name is the Host's own proof that a directory is the one it
    // minted. A Session moved to another directory keeps that directory.
    const kept = await mkdtemp(join(tmpdir(), 'dsh-session-moved-'))
    tempDirs.push(kept)
    await writeFile(join(kept, 'notes.txt'), 'the user owns this')
    const h = deleteContext({
      temporarySessionIds: ['moved'],
      cwds: { moved: join(kept, 'somewhere-else') },
    })
    await expect(h.controller.delete({ sessionId: 'moved' as SessionId })).resolves.toEqual({ deleted: true })
    expect(await readFile(join(kept, 'notes.txt'), 'utf8')).toBe('the user owns this')
  })

  it('refuses the deletion when a provider will not stop', async () => {
    const directory = await makeTemporaryDir('stubborn-stop')
    const h = deleteContext({
      temporarySessionIds: ['stubborn-stop'],
      temporaryRoot: join(directory, '..'),
      activity: [{ kind: 'job' }],
      stopFails: 'job will not stop',
    })
    await expect(h.controller.delete({ sessionId: 'stubborn-stop' as SessionId, stopActivity: true }))
      .rejects.toMatchObject({ code: 'session/stop-failed', details: { reasons: ['Error: job will not stop'] } })
    // Nothing was removed: the work that refused to stop still owns its files.
    expect(h.deleted).toEqual([])
    expect(h.forgotten).toEqual([])
    expect(await readFile(join(directory, 'artifact.txt'), 'utf8')).toBeDefined()
  })
})
