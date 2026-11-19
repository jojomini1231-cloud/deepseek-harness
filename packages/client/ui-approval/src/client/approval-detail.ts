/** Payload text for a pending approval, read from the Host's pending-call projection. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `approvalPayload` SessionProjectionMap key this reads.
import type { ApprovalPayloadView } from '@deepseek-ai/dsh-user-approval/types'

/**
 * Reads the arguments of the Tool call a request settles. The Host folds them
 * into the Session list, so a Session that was never opened still answers —
 * the Conversation assembly it would otherwise need follows retention only.
 * @param ctx - client root context owning the Session list.
 * @returns the resolver both approval surfaces call.
 */
export function approvalPayload(ctx: Context): (sessionId: SessionId, callId: ToolCallId | undefined) => string | undefined {
  return (sessionId, callId) => {
    if (callId === undefined) return undefined
    const block: ApprovalPayloadView | undefined =
      ctx.sessions.list.getSnapshot().projectionsBySession[sessionId]?.values.approvalPayload
    return block?.requests.find(request => request.callId === callId)?.payload
  }
}
