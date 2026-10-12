import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { pinOrderAccounts, pinOrderSource } from '../src/client/pin-order.ts'
import { FLAT_SESSION_ORDER_KEY } from '../src/client/stores.ts'
import { TEMPORARY_KEY, UNGROUPED_KEY } from '../src/client/tree.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string): SessionSummary => ({
  id: sid(id), title: id, displayTitle: id, running: false, blank: false,
  updatedAt: 1, retainedBy: {},
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  phase: 'ready', projectionsBySession: {},
})
const workspace = (id: string, sessionIds: string[]): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title: id,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const rows = (temporary: readonly string[] = []) => ({
  pinnedSessionIds: [] as readonly SessionId[],
  archivedSessionIds: [] as readonly SessionId[],
  temporarySessionIds: temporary.map(sid),
})

describe('pinOrderSource', () => {
  it('splits loose Sessions into the temporary and Ungrouped accounts', () => {
    const source = pinOrderSource(
      [workspace('first', ['owned'])],
      list(summary('owned'), summary('temp'), summary('loose')),
      rows(['temp']),
    )

    expect(source.members[TEMPORARY_KEY]).toEqual([sid('temp')])
    expect(source.members[UNGROUPED_KEY]).toEqual([sid('loose')])
    expect(source.members[FLAT_SESSION_ORDER_KEY]).toEqual([sid('owned'), sid('temp'), sid('loose')])
  })

  it('removes a temporary Session from its Workspace account so only one section owns it', () => {
    const source = pinOrderSource(
      [workspace('first', ['owned', 'shared'])],
      list(summary('owned'), summary('shared'), summary('other')),
      rows(['shared']),
    )

    expect(source.members['first']).toEqual([sid('owned')])
    expect(source.members[TEMPORARY_KEY]).toEqual([sid('shared')])
    // It is accounted for by a Workspace, so it is not loose.
    expect(source.members[UNGROUPED_KEY]).toEqual([sid('other')])
  })
})

describe('pinOrderAccounts', () => {
  it('fronts the temporary account for a temporary member and its Workspace otherwise', () => {
    const workspaces = [workspace('first', ['owned'])]

    expect(pinOrderAccounts(workspaces, sid('owned'))).toEqual(['first', FLAT_SESSION_ORDER_KEY])
    expect(pinOrderAccounts(workspaces, sid('loose'))).toEqual([UNGROUPED_KEY, FLAT_SESSION_ORDER_KEY])
    expect(pinOrderAccounts(workspaces, sid('owned'), [sid('owned')]))
      .toEqual([TEMPORARY_KEY, FLAT_SESSION_ORDER_KEY])
  })
})
