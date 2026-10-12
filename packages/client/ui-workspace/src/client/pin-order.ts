/**
 * The complete account memberships a Pin order write reconciles against,
 * derived from the same Host snapshots the browser orders by, so the
 * UiWorkspace service can complete the write without the browser in the loop.
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import {
  owningGroupKey, sessionMemberIds, TEMPORARY_KEY, UNGROUPED_KEY, type SessionRowState,
} from './tree.ts'

/** What `pinSessionOrder` reconciles a pinned Session's accounts against. */
export interface PinOrderSource {
  members: Readonly<Record<string, readonly SessionId[]>>
  summaries: SessionListState['byId']
  rowState: Pick<SessionRowState, 'pinnedSessionIds' | 'archivedSessionIds'>
}

/**
 * Every account's complete membership: each Workspace, the temporary bucket,
 * Ungrouped, and the flat list. A Session in the temporary set belongs to that
 * bucket alone, so it is excluded from its Workspace and Ungrouped accounts —
 * the same ownership {@link scanGroups} applies to the rendered rows.
 * @param workspaces - current Host Workspaces.
 * @param list - current Session list snapshot.
 * @param rowState - registry-global pin, archive, and temporary sets.
 * @returns the order source for one pin write.
 */
export function pinOrderSource(
  workspaces: readonly WorkspaceView[],
  list: SessionListState,
  rowState: PinOrderSource['rowState'] & Pick<SessionRowState, 'temporarySessionIds'>,
): PinOrderSource {
  const temporary = new Set(rowState.temporarySessionIds)
  const known = (id: SessionId): boolean => list.byId[id] !== undefined
  const loose = list.ids.filter(id => known(id) && !workspaces.some(workspace => workspace.sessionIds.includes(id)))
  return {
    members: Object.fromEntries([
      ...workspaces.map(workspace => [
        workspace.workspaceId, workspace.sessionIds.filter(id => !temporary.has(id)),
      ] as const),
      [TEMPORARY_KEY, list.ids.filter(id => known(id) && temporary.has(id))],
      [UNGROUPED_KEY, loose.filter(id => !temporary.has(id))],
      [FLAT_SESSION_ORDER_KEY, sessionMemberIds(list)],
    ]),
    summaries: list.byId,
    rowState,
  }
}

/**
 * The accounts a pinned Session leads: its group (workspace, temporary, or
 * Ungrouped) and the flat list.
 * @param workspaces - current Host Workspaces.
 * @param sessionId - the Session being pinned.
 * @param temporarySessionIds - registry-global temporary set.
 * @returns the account keys `pinSessionOrder` fronts.
 */
export function pinOrderAccounts(
  workspaces: readonly WorkspaceView[],
  sessionId: SessionId,
  temporarySessionIds: readonly SessionId[] = [],
): readonly string[] {
  return [owningGroupKey(workspaces, sessionId, temporarySessionIds), FLAT_SESSION_ORDER_KEY]
}
