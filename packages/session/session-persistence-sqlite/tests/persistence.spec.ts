/** Shared persistence semantics and SQLite plugin activation. @module */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { meta, oneTurnLog, runPersistenceContract } from '../../session-persistence/tests/contract.ts'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { persistenceFixture } from './fixtures/persistence.ts'
import { storedEvents } from './fixtures/store.ts'

runPersistenceContract('sqlite', async () => {
  const fixture = await persistenceFixture()
  const backend = await fixture.mount('sqlite')
  return {
    persistence: backend.persistence,
    dispose: () => backend.context.fiber.dispose(),
    reopen: async () => {
      const reopened = await fixture.mount('sqlite')
      return { persistence: reopened.persistence, dispose: () => reopened.context.fiber.dispose() }
    },
  }
})

describe('SQLite persistence plugin', () => {
  it('registers the service before creating the database and initializes on first create', async () => {
    const fixture = await persistenceFixture()
    const { persistence } = await fixture.mount('sqlite')
    expect(persistence).toBeDefined()
    expect(await persistence.list()).toEqual([])
    expect(await readdir(fixture.root)).toEqual([])
    const writer = await persistence.create(meta('first-create'))
    await writer.flush()
    await writer.close()
    expect(await readdir(join(fixture.root, '.segments'))).toContain('sessions.sqlite')
  })

  it('stores one complete logical event stream in an independent root segment', async () => {
    const fixture = await persistenceFixture()
    const { persistence, context } = await fixture.mount('sqlite')
    const header = meta('root-segment', '/workspace')
    const events = oneTurnLog()
    const writer = await persistence.create(header)
    await writer.append(events)
    await writer.close()
    await context.fiber.dispose()
    const db = new DatabaseSync(join(fixture.root, '.segments', 'sessions.sqlite'))
    try {
      const thread = db.prepare('SELECT header, tail_segment_uuid FROM traces WHERE trace_uuid = ?').get(header.id)
      expect(JSON.parse(String(thread?.header))).toEqual({ ...header, delegationDepth: 0 })
      const segment = db.prepare('SELECT parent_segment_uuid, parent_end_seq, base_seq FROM segments WHERE segment_uuid = ?').get(thread?.tail_segment_uuid as string)
      expect(segment).toEqual({ parent_segment_uuid: null, parent_end_seq: null, base_seq: 0 })
      expect(storedEvents(db, thread?.tail_segment_uuid as string)).toEqual(events)
    } finally {
      db.close()
    }
  })

  it('keeps the default JSONL provider independent of SQLite storage', async () => {
    const fixture = await persistenceFixture()
    const { persistence } = await fixture.mount('jsonl')
    const writer = await persistence.create(meta('default-jsonl', '/workspace'))
    await writer.append(oneTurnLog())
    await writer.close()
    expect(await readdir(fixture.root)).not.toContain('.segments')
  })

  it('drains live Session events before provider disposal', async () => {
    const fixture = await persistenceFixture()
    const { persistence, context } = await fixture.mount('sqlite')
    const session = context.sessions.create(meta('shutdown-drain').id)
    await persistence.create(session.header)
    const events = [
      session.append('turn/start', { turn: 1 }),
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    await context.fiber.dispose()
    const reopened = await fixture.mount('sqlite')
    const reader = await reopened.persistence.open(session.id, 'read')
    expect((await reader.read()).events).toEqual(events)
    await reader.close()
  })

  it('keeps the Segments a fork still inherits when its source is deleted', async () => {
    const fixture = await persistenceFixture()
    const { persistence } = await fixture.mount('sqlite')
    const source = await persistence.create(meta('delete-source', '/workspace'))
    const prefix = oneTurnLog()
    await source.append(prefix)
    const child = await persistence.create(meta('delete-child', '/workspace'), {
      parentSource: { sessionId: source.header.id, endSeq: SessionLogOffset(2), events: prefix },
    })
    await child.close()
    await source.close()

    await persistence.delete(source.header.id)

    // The child still reads the shared prefix, and the retained Segment keeps
    // its frames: the append-only triggers still guard what survived.
    const reader = await persistence.open(child.header.id, 'read')
    expect((await reader.read()).events).toEqual(prefix)
    await reader.close()
    const db = new DatabaseSync(join(fixture.root, '.segments', 'sessions.sqlite'))
    try {
      expect(db.prepare('SELECT count(*) AS n FROM traces').get()).toEqual({ n: 1 })
      expect(() => { db.exec('DELETE FROM frames') }).toThrow('frames are append-only')
    } finally { db.close() }
  })

  it('removes the routing record with the deleted Session and republishes it on reuse', async () => {
    const fixture = await persistenceFixture()
    const { persistence } = await fixture.mount('sqlite')
    const header = meta('delete-routed', '/workspace')
    const writer = await persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.close()
    const markers = async () => (await readdir(join(fixture.root, '.segments'))).filter(name => name.endsWith('.json'))
    expect(await markers()).toHaveLength(1)

    await persistence.delete(header.id)
    expect(await markers()).toEqual([])

    // The id is free: a later create stores fresh content and routes it again.
    const recreated = await persistence.create(header)
    await recreated.append(oneTurnLog())
    await recreated.close()
    expect(await markers()).toHaveLength(1)
    expect((await persistence.stat(header.id))?.eventCount).toBe(oneTurnLog().length)
  })

  it('deletes a legacy JSONL identity this provider never imported', async () => {
    const fixture = await persistenceFixture()
    const legacy = await fixture.mount('jsonl')
    const header = meta('delete-legacy', '/workspace')
    const writer = await legacy.persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.close()

    const { persistence } = await fixture.mount('sqlite')
    await persistence.delete(header.id)

    expect(await persistence.stat(header.id)).toBeUndefined()
    await expect(legacy.persistence.open(header.id, 'read')).rejects.toThrow(SessionPersistenceNotFoundError)
  })
})
