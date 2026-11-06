/** Session commands whose activation policy is explicit at each Remote method. */

import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { continuationProjectionDefinition, type ContinuationState } from './continuation.ts'

import { modelAvailable } from './catalog.ts'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentAdmissionPart,
} from '@deepseek-ai/dsh-attachment'
import type { FileUploadReceiptId, StagedAttachment } from '@deepseek-ai/dsh-client-file-upload/types'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import {
  ReasoningEffortId, createDeveloperMessage, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionLogOffset, SessionSeq, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  ApiSessionPresetConflict,
  ApiSessionSubagentOwnership,
  apiSessionSubagentOwnershipError,
  hasApiSessionSubagentOwner,
  type ApiSessionCreated,
} from './agent.ts'
import type {
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionDeleteRequest,
  SessionDeleteValue,
  SessionForkRequest,
  SessionForkValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionRetractRequest,
  SessionRetractValue,
  SessionEditRequest,
  SessionEditValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionRequestId,
} from './types.ts'

type PromptContentCandidate =
  | SessionPromptRequest['content'][number]
  | Extract<SessionUpdateQueueRequest['action'], { readonly kind: 'edit' }>['content'][number]

/**
 * Whether a Session's stored cwd lies inside the temporary root. A create that
 * mints a temporary cwd places it directly under the root, so a stored path
 * outside the root identifies an ordinary Session.
 * @param root - absolute temporary workspace root.
 * @param cwd - the Session's stored working directory.
 * @returns true when the cwd is the root itself or a descendant of it.
 */
function isUnder(root: string, cwd: string): boolean {
  const rest = relative(root, cwd)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

/**
 * Whether prompt content carries non-whitespace text or an attachment.
 * @param content - submitted or edited prompt parts.
 * @returns whether any part supplies ordinary prompt content.
 */
export function hasPromptContent(content: readonly PromptContentCandidate[]): boolean {
  return content.some(part => part.type !== 'text' || part.text.trim().length > 0)
}

/**
 * Resolve the omitted-`atSeq` default to the latest completed-turn prefix,
 * including standalone events before the next turn begins.
 */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/**
 * One retraction target and the current-surface range it rewrites. An empty
 * surface tail retracts nothing, so the marker appends instead of replacing.
 */
type RewindPlan =
  | { readonly kind: 'append'; readonly targetSeq: SessionSeq }
  | {
    readonly kind: 'replace'
    readonly targetSeq: SessionSeq
    readonly startSeq: SessionSeq
    readonly endSeq: SessionSeq
    readonly shadowedSeqs: readonly SessionSeq[]
  }

/**
 * The turn and step coordinates a retraction marker records. The marker is
 * appended between turns, so it stands at the end of the last observed step's
 * position.
 * @param events - exact observed Session history.
 * @returns the latest observed turn and step, both 0 before the first turn.
 */
function lastTurnStep(events: readonly SessionEvent[]): { turn: number; step: number } {
  let turn = 0
  let step = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      turn = event.data.turn
      step = 0
    } else if (event.type === 'step/start') {
      step = event.data.step
    }
  }
  return { turn, step }
}

/**
 * Replace one user message's text while keeping its non-text blocks in order.
 * The new text takes the first text block's position, or the end when the
 * original message carried none.
 * @param content - original admitted content blocks.
 * @param text - replacement text.
 * @returns the edited content blocks.
 */
function editedContent(content: readonly ContentBlock[], text: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let placed = false
  for (const block of content) {
    if (block.type !== 'text') {
      blocks.push(block)
    } else if (!placed) {
      blocks.push({ type: 'text', text })
      placed = true
    }
  }
  if (!placed) blocks.push({ type: 'text', text })
  return blocks
}

/** Implements Session business commands delegated by the Session Controller Remote service. */
export class SessionCommandController {
  /** First-insertion facts cached per exact Session; the log remains the recovery source. */
  private readonly promptReceipts = new WeakMap<Session, {
    offset: SessionLogOffset
    messages: Set<MessageId>
    requests: Set<SessionRequestId>
  }>()

  private continuation!: ProjectionHandle<ContinuationState>

  /** Register complete-history empty-prompt eligibility. @returns when command admission is ready. */
  async initialize(): Promise<void> {
    this.continuation = await this.ctx.sessionProjections.register(continuationProjectionDefinition)
  }

  /**
   * @param ctx - Host context carrying Agent, model, attachment, title, and Workspace services.
   * @param agents - sole owner of create, resume, and Agent composition.
   * @param defaultCwd - project directory used when create names neither a Workspace nor a cwd.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Create one ordinary Session for a new conversation, reusing the named blank
   * Session while it is reusable. A request naming neither a Workspace nor a
   * cwd, with `temporary: true`, gets a directory under the workspace
   * controller's temporary root.
   * @param request - requested identity, location, Agent preset, and whether this is a workspace-less temporary Session.
   * @param signal - caller lifetime; cancels the temporary root's native Documents lookup.
   * @returns the created or reused Session identity and its preset when configured.
   */
  async create(request: SessionCreateRequest, signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both', {})
    }
    if (request.temporary === true && (request.workspaceId !== undefined || request.cwd !== undefined)) {
      throw new RemoteError('gateway/bad-request', 'session.create accepts temporary alone, not with workspaceId or cwd', {})
    }
    const temporarySessionId = request.sessionId ?? brandString<SessionId>(`session-${randomUUID()}`)
    let workspace: Workspace | undefined
    if (request.workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${request.workspaceId}" not found`, {
          workspaceId: request.workspaceId,
        })
      }
    }
    const temporary = request.temporary === true
      ? await this.temporaryCwd(temporarySessionId, request.sessionId !== undefined, signal)
      : undefined
    const cwd = workspace?.path ?? request.cwd ?? temporary?.cwd ?? this.defaultCwd
    let created: ApiSessionCreated
    try {
      created = await this.agents.createSession({
        ...(request.sessionId === undefined && request.temporary !== true
          ? {}
          : { sessionId: request.temporary === true ? temporarySessionId : request.sessionId }),
        cwd,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        reusable: sessionId => !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)
          && (workspace === undefined || workspace.sessionIds.includes(sessionId)),
      })
    } catch (error) {
      this.rejectCreation(error)
    }
    const sessionId = created.agent.id
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId, workspaceId: workspace.id },
        )
      }
    }
    // Only a directory this Host minted classifies the Session. An adopting
    // request reuses a stored working directory and must never add an existing
    // Session to the temporary set, because that set is the sole authorization
    // for the irreversible deletion below.
    if (temporary?.minted === true) {
      try {
        await this.ctx.workspaceRegistry.markTemporarySession(sessionId)
      } catch (error) {
        // The directory and the Session log exist, but nothing re-derives the
        // classification from them, so a swallowed failure would leave a
        // Session the Temporary section can never show. Report it the way the
        // Workspace-attach branch reports its own post-create failure.
        throw new RemoteError(
          'session/temporary-mark-failed',
          `session "${sessionId}" was created but could not be marked temporary: ${String(error)}`,
          { sessionId },
        )
      }
    }
    return { sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }) }
  }

  /**
   * Permanently delete one temporary Session: its stored log, its
   * Session-local directory under the temporary root, its classification in
   * the Workspace registry, and every subagent descendant it owns.
   *
   * Only a temporary Session may be deleted. Its subagent descendants go with
   * it: they exist only through the lineage this deletion removes, and no
   * surface can reach or delete one on its own. Running work is reported by
   * the Workspace registry's providers — for the whole lineage, so a running
   * subagent counts — and refused as `session/active` unless `stopActivity`
   * asks for the stops first.
   * @param request - Session identity and whether to stop its running work.
   * @param signal - caller lifetime; cancels the temporary root's native Documents lookup.
   * @returns deletion confirmation.
   */
  async delete(request: SessionDeleteRequest, signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<SessionDeleteValue> {
    const { sessionId } = request
    if (!this.ctx.workspaceRegistry.temporarySessionIds.includes(sessionId)) {
      throw new RemoteError(
        'session/not-temporary',
        `session "${sessionId}" is not a temporary session and cannot be deleted`,
        { sessionId },
      )
    }
    const descendants = await this.descendantSessions(sessionId, signal)
    if (request.stopActivity !== true) {
      const activity = await this.ctx.waterfall(
        'workspace/session-activity', { sessionId }, () => Promise.resolve([]),
      )
      if (activity.length > 0) {
        throw new RemoteError(
          'session/active',
          `session "${sessionId}" still has running work`,
          { sessionId, activity },
        )
      }
    } else {
      await this.stopSessionActivity(sessionId)
    }
    // Read the directory before anything is removed: it is the Session's own
    // stored working directory, and the log that carries it is about to go.
    const directory = await this.storedCwdOf(sessionId, signal)
    try {
      // Descendants before the root: a failure then leaves the root, and with
      // it the temporary classification that makes the retry reachable.
      for (const descendant of [...descendants].reverse()) await this.removeSubagentSession(descendant, signal)
      // The Agent must be gone before its log is removed: its persistence
      // write handle would otherwise recreate the artifact this call deletes.
      await this.agents.disposeAgent(sessionId)
      await this.deleteStoredLog(sessionId, signal)
      await this.removeTemporaryDirectory(sessionId, directory)
      await this.ctx.workspaceRegistry.forgetSession(sessionId)
    } catch (error: unknown) {
      if (remoteErrorOf(error) !== undefined) throw error
      throw new RemoteError(
        'session/delete-failed',
        `failed to delete session "${sessionId}": ${String(error)}`,
        { sessionId },
        { cause: error },
      )
    }
    return { deleted: true }
  }

  /**
   * Remove one deleted Session's stored log. An absent log resolves: a retry
   * after a partial failure reaches this step with the log already gone, and
   * that is the state this step exists to reach rather than a failure. Without
   * it every later failure would leave the Session permanently undeletable.
   */
  private async deleteStoredLog(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return
    try {
      await persistence.delete(sessionId, { signal })
    } catch (error: unknown) {
      // A static import would require the optional peer at module load; the
      // service exists here, so its error module is available.
      const { SessionPersistenceNotFoundError } = await import('@deepseek-ai/dsh-session-persistence')
      if (!(error instanceof SessionPersistenceNotFoundError)) throw error
    }
  }

  /**
   * Remove one deleted Session's subagent descendant: its live Agent, its
   * stored log, and any classification membership a deleted id must not keep.
   *
   * No directory removal belongs here. A descendant's stored working directory
   * is its root's, whose leaf name the root's own removal proves, so this step
   * never claims a path for a child.
   * @param sessionId - the descendant to remove.
   * @param signal - caller lifetime.
   */
  private async removeSubagentSession(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    await this.agents.disposeAgent(sessionId)
    await this.deleteStoredLog(sessionId, signal)
    await this.ctx.workspaceRegistry.forgetSession(sessionId)
  }

  /**
   * The live or stored subagent descendants of one Session, by durable
   * lineage. A fork shares the parent field without the subagent origin and
   * is an independent conversation, so only the origin-bearing children
   * count — the same rule the Subagent runtime's archive admission applies.
   * @param rootId - the Session whose lineage is walked.
   * @param signal - caller lifetime.
   * @returns every descendant, parents before their own children.
   */
  private async descendantSessions(rootId: SessionId, signal: AbortSignal): Promise<readonly SessionId[]> {
    const descendants: SessionId[] = []
    const visited = new Set<SessionId>([rootId])
    const pending: SessionId[] = [rootId]
    const records = await this.ctx.sessionQuery.listSessions(signal)
    while (pending.length > 0) {
      const parentId = pending.shift() as SessionId
      for (const record of records) {
        const { parentSession, origin, id } = record.header
        if (origin !== 'subagent' || parentSession !== parentId || visited.has(id)) continue
        visited.add(id)
        descendants.push(id)
        pending.push(id)
      }
    }
    return descendants
  }

  /**
   * Request every provider's stop, refusing the deletion when any provider
   * fails. A provider that did not stop may still be writing into the very
   * directory the deletion is about to remove, and the caller asked to stop it
   * before deleting; continuing would report a stop that never happened.
   * @param sessionId - Session whose running work must stop.
   * @throws {RemoteError} `session/stop-failed` when any provider refused.
   */
  private async stopSessionActivity(sessionId: SessionId): Promise<void> {
    let failures: readonly unknown[] = []
    try {
      await this.ctx.parallel('workspace/session-stop', { sessionId })
    } catch (error: unknown) {
      // ctx.parallel settles every listener and rejects with one AggregateError.
      failures = error instanceof AggregateError ? error.errors : [error]
    }
    if (failures.length === 0) return
    const reasons = failures.map(failure => String(failure))
    for (const reason of reasons) {
      this.ctx.logger.warn(`session-controller: stopping session '${sessionId}' for deletion failed: ${reason}`)
    }
    throw new RemoteError(
      'session/stop-failed',
      `session "${sessionId}" could not be stopped for deletion: ${reasons.join('; ')}`,
      { sessionId, reasons },
    )
  }

  /**
   * Remove one deleted Session's own directory.
   *
   * The target is the Session's stored working directory, never a path
   * re-derived from the current temporary root: the deployment may have
   * re-pointed that root since the Session was made, and re-deriving would
   * erase an unrelated directory while leaving the real one behind. The leaf
   * name is what proves the directory is the one this Host minted for this
   * Session — the create path mints it as `<root>/<sessionId>` — so the proof
   * holds whatever root it was created under. A Session whose working
   * directory was moved elsewhere keeps that directory; nothing here removes a
   * path the user pointed somewhere themselves.
   * @param sessionId - the deleted Session whose leaf directory name applies.
   * @param directory - its stored working directory, or undefined when unknown.
   */
  private async removeTemporaryDirectory(sessionId: SessionId, directory: string | undefined): Promise<void> {
    if (directory === undefined || basename(directory) !== sessionId) return
    // A filesystem root has no parent; removing one is never this call's intent.
    if (dirname(directory) === directory) return
    await rm(directory, { recursive: true, force: true })
  }

  /**
   * Resolve the working directory for a workspace-less temporary Session:
   * `<temporary root>/<sessionId>`. An adopting request whose Session already
   * exists keeps its stored cwd, so changing the configured root never
   * conflicts with an already-created Session. The Host's create path makes
   * the directory recursively afterwards.
   * @param sessionId - the (possibly client-supplied) Session id that names the leaf directory.
   * @param adopting - whether the request carried an explicit Session id to adopt.
   * @param signal - caller lifetime; cancels the native Documents lookup.
   * @returns the absolute working directory, and whether this call minted it.
   */
  private async temporaryCwd(
    sessionId: SessionId, adopting: boolean, signal: AbortSignal,
  ): Promise<{ readonly cwd: string; readonly minted: boolean }> {
    if (adopting) {
      const storedCwd = await this.storedCwdOf(sessionId, signal)
      // An adopting request reuses the stored directory: it was chosen when the
      // Session was made, and every create path that produces a temporary
      // Session puts it under the temporary root. A stored cwd that is not
      // under that root is an ordinary Session, which this request must not
      // reclassify as temporary.
      if (storedCwd !== undefined) {
        const root = await this.requireTemporaryRoot(signal)
        if (isUnder(root, storedCwd)) return { cwd: storedCwd, minted: false }
        throw new RemoteError(
          'gateway/bad-request',
          `session "${sessionId}" is not a temporary session: its cwd "${storedCwd}" is outside "${root}"`,
          {},
        )
      }
    }
    if (sessionId === '' || sessionId === '.' || sessionId === '..' || /[/\\]/.test(sessionId)) {
      throw new RemoteError('gateway/bad-request', `session id "${sessionId}" is not a usable directory name`, {})
    }
    return { cwd: join(await this.requireTemporaryRoot(signal), sessionId), minted: true }
  }

  /**
   * One stored Session's working directory, or undefined when no such Session
   * exists yet.
   * @param sessionId - the Session to look up.
   * @param signal - caller lifetime.
   * @returns the stored cwd, or undefined for an unknown Session.
   */
  private async storedCwdOf(sessionId: SessionId, signal: AbortSignal): Promise<string | undefined> {
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none', signal })
      return observation.header.cwd
    } catch (error: unknown) {
      if (!(error instanceof SessionQueryError)
        || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
      return undefined
    }
  }

  /**
   * The absolute temporary root, or the failure a Host without the Workspace
   * controller reports.
   * @param signal - caller lifetime; cancels the native Documents lookup.
   * @returns the resolved temporary workspace root.
   */
  private async requireTemporaryRoot(signal: AbortSignal): Promise<string> {
    const workspaceController = this.ctx.get('workspaceController')
    if (workspaceController === undefined) {
      throw new RemoteError('gateway/internal', 'temporary sessions require the Workspace controller', {})
    }
    return await workspaceController.temporaryRoot(signal)
  }

  /**
   * Validate and record one Session model selection; save the default in the background.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection recorded for the Session, without waiting for default persistence.
   */
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.agents.serializeImageAdmission(agent, async () => {
      try {
        await this.requireModel(request)
        const selected: AgentModelSelection = {
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        }
        await this.ctx.llm.resolveCallConfig(selected)
        agent.model.select(selected)
        void this.ctx.agentDefaultModel.saveSelection(selected).catch((error: unknown) => {
          this.ctx.logger.warn(
            `session-controller: model selection changed for the Session but the default was not saved: ${String(error)}`,
          )
        })
        return { selected: { ...selected } }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'session/model-unavailable',
          error instanceof Error ? error.message : String(error),
          { provider: request.provider, model: request.model },
        )
      }
    })
  }

  /**
   * Normalize and append a user-owned Session title.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    const agent = await this.resolveAgent(request.sessionId)
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) {
      throw new RemoteError('gateway/internal', 'renaming is unavailable: this deployment mounts no session-title service', {})
    }
    try {
      const accepted = titles.rename(agent.session, request.title)
      return { title: accepted.title, seq: accepted.eventSeq }
    } catch (error) {
      if (error instanceof SessionTitleInvalidError) {
        throw new RemoteError('session/title-invalid', error.message, { sessionId: request.sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `failed to rename session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
  }

  /**
   * Create a new ordinary Session from an exact event prefix. An explicit
   * `atSeq` is the inclusive cut; an omitted value selects the latest
   * completed-turn prefix. An open cut receives synthetic fork closers.
   * @param request - source Session and optional exact event boundary.
   * @returns the new Session identity.
   */
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    let atSeq: ReturnType<typeof SessionSeq> | undefined
    try {
      atSeq = request.atSeq === undefined ? undefined : SessionSeq(request.atSeq)
    } catch {
      throw new RemoteError('gateway/bad-request', 'atSeq must be a non-negative safe integer', {})
    }
    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(request.sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${request.sessionId}" not found`, {
          sessionId: request.sessionId,
        })
      }
      throw new RemoteError(
        'gateway/internal',
        `fork source unavailable for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    using source = observed
    const boundary = atSeq ?? latestCompletedPrefixBoundary(source.events)
    if (boundary === undefined || source.events[boundary]?.seq !== boundary) {
      throw new RemoteError(
        'session/fork-unavailable',
        request.atSeq === undefined
          ? `session "${request.sessionId}" has no completed turn to fork from`
          : `event ${String(request.atSeq)} does not exist in session "${request.sessionId}" (last seq: ${String(source.events.at(-1)?.seq ?? 'none')})`,
        { sessionId: request.sessionId },
      )
    }
    const seed = buildForkSeed(source.events, boundary)
    let workspace: Workspace | undefined
    try {
      workspace = await this.forkWorkspace(source.header)
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to resolve fork workspace for session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.agents.composeAgent(this.agents.presetForObservation(source))
    try {
      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      await this.ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: SessionLogOffset(boundary + 1),
        meta: {
          ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
          isSeeded: true,
          ...(composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset }),
        },
        agentOptions: { provider, model },
        setup: composition.setup,
      })
    } catch (error) {
      throw new RemoteError(
        'gateway/internal',
        `failed to fork session "${request.sessionId}": ${String(error)}`,
        {},
      )
    }
    if (workspace !== undefined) {
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new RemoteError(
          'session/workspace-attach-failed',
          `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
          { sessionId: childId, workspaceId: workspace.id },
        )
      }
    }
    return { sessionId: childId }
  }

  /**
   * Retract one conversation branch: append the durable marker that replaces
   * the current surface range from the target user message through its tail.
   * The target and everything after it stay in the event log but leave the
   * derived model history and the client surface.
   * @param request - Session identity and the target user message's durable seq.
   * @returns the durable sequence of the retraction marker.
   */
  async retract(request: SessionRetractRequest): Promise<SessionRetractValue> {
    const agent = await this.resolveAgent(request.sessionId)
    this.assertRewindIdle(agent, request.sessionId)
    using observation = await this.observeRewindHistory(request.sessionId)
    // The re-check, the current-surface read, and the append share one
    // synchronous segment, so a turn that started during the observation is
    // refused instead of interleaving with the marker.
    this.assertRewindIdle(agent, request.sessionId)
    const { plan } = this.resolveRewind(agent, request, observation.events)
    return { seq: this.appendRewindMarker(agent.session, plan, observation.events).seq }
  }

  /**
   * Edit one user message: record the retraction marker, then admit the
   * replacement text with the target's non-text content blocks as the next
   * turn's ordinary user message. Both steps run after every validation has
   * passed, so a marker that is already durable when admission fails names its
   * own sequence in the failure.
   * @param request - Session identity, target user message seq, and replacement text.
   * @returns the durable sequence of the edited user message.
   */
  async edit(request: SessionEditRequest): Promise<SessionEditValue> {
    if (request.text.trim().length === 0) {
      throw new RemoteError('session/edit-empty', 'edited message text must include non-whitespace characters', {})
    }
    const agent = await this.resolveAgent(request.sessionId)
    this.assertRewindIdle(agent, request.sessionId)
    using observation = await this.observeRewindHistory(request.sessionId)
    // The re-check, the current-surface read, the marker append, and the
    // admission share one synchronous segment, so a turn that started during
    // the observation is refused instead of interleaved with the rewrite.
    this.assertRewindIdle(agent, request.sessionId)
    const { target, plan } = this.resolveRewind(agent, request, observation.events)
    const message = createUserMessage({
      content: editedContent(target.content, request.text),
      source: { kind: 'user' },
    })
    const marker = this.appendRewindMarker(agent.session, plan, observation.events)
    const recorded = Promise.withResolvers<SessionSeq>()
    const stopEvent = this.ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'user/message' || event.data.id !== message.id) return
      recorded.resolve(event.seq)
    })
    const stopStatus = this.ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      const stillPending = agent.inbox.nextTurn.some(item => item.id === message.id)
        || agent.inbox.nextStep.some(item => item.id === message.id)
      if (stillPending) return
      recorded.reject(new RemoteError(
        'gateway/internal',
        `session "${agent.id}": the retraction was recorded at seq ${String(marker.seq)} but the edited message was not admitted`,
        { sessionId: agent.id },
      ))
    })
    try {
      agent.followup(message)
      return { seq: await recorded.promise }
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        `session "${agent.id}": the retraction was recorded at seq ${String(marker.seq)} but the edited message was not admitted: ${String(error)}`,
        { sessionId: agent.id },
        { cause: error },
      )
    } finally {
      stopEvent()
      stopStatus()
    }
  }

  /**
   * Refuse a rewind while the Session runs work or holds pending input, so the
   * surface range resolved here is still the range its event replaces.
   * @param agent - Session Agent whose activity gates the rewind.
   * @param sessionId - addressed Session identity for the failure details.
   */
  private assertRewindIdle(agent: Agent, sessionId: SessionId): void {
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
      throw new RemoteError(
        'session/busy',
        `session "${sessionId}" has a running turn or pending input`,
        { sessionId },
      )
    }
  }

  /**
   * Read the exact Session history one rewind inspects. Only the observer's
   * asynchronous read may access historical events; the returned lease stays
   * valid while the caller computes the range and appends the marker.
   * @param sessionId - addressed Session identity.
   * @returns the exact observation, disposed with the caller's scope.
   */
  private async observeRewindHistory(sessionId: SessionId): Promise<SessionObservation> {
    try {
      return await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    } catch (error: unknown) {
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" history is unavailable: ${String(error)}`,
        { sessionId },
        { cause: error },
      )
    }
  }

  /**
   * Validate one rewind request's target message and resolve its placement.
   * @param agent - Session Agent owning the target.
   * @param request - Session identity and target event sequence.
   * @param events - exact observed Session history at the rewind cut.
   * @returns the target message and the surface range the rewind rewrites.
   */
  private resolveRewind(
    agent: Agent,
    request: SessionRetractRequest,
    events: readonly SessionEvent[],
  ): { target: UserMessage; plan: RewindPlan } {
    let targetSeq: SessionSeq
    try {
      targetSeq = SessionSeq(request.targetSeq)
    } catch {
      throw this.rewindUnavailable(request)
    }
    const event = events[targetSeq]
    if (event === undefined || event.seq !== targetSeq
      || event.type !== 'user/message' || event.data.source.kind !== 'user') {
      throw this.rewindUnavailable(request)
    }
    return {
      target: event.data,
      plan: this.surfacePlacement(agent.session, request.sessionId, targetSeq, events),
    }
  }

  /** The stable refusal for a target that is not a plain user message of this Session. */
  private rewindUnavailable(request: SessionRetractRequest): RemoteError {
    return new RemoteError(
      'session/rewind-unavailable',
      `session "${request.sessionId}" has no plain user message at seq ${request.targetSeq}`,
      { sessionId: request.sessionId, targetSeq: request.targetSeq },
    )
  }

  /**
   * Resolve the current surface range one rewind replaces. A target still on
   * the surface is retracted from itself; one an earlier replacement shadowed
   * rewinds from the node after that replacement, so a compaction summary
   * survives. A range with no shadowed node records an append instead.
   * @param session - Session whose current surface is rewritten.
   * @param sessionId - addressed Session identity for the failure details.
   * @param targetSeq - validated target message sequence.
   * @param events - exact observed Session history supplying replacement citations.
   * @returns the append-only or replacing range the rewind records.
   */
  private surfacePlacement(
    session: Session,
    sessionId: SessionId,
    targetSeq: SessionSeq,
    events: readonly SessionEvent[],
  ): RewindPlan {
    const nodes = session.surface.nodes
    const targetIndex = nodes.indexOf(targetSeq)
    const startIndex = targetIndex >= 0
      ? targetIndex
      : this.surfaceStandInIndex(events, nodes, sessionId, targetSeq) + 1
    const shadowedSeqs = nodes.slice(startIndex)
    const [startSeq] = shadowedSeqs
    const endSeq = shadowedSeqs.at(-1)
    return startSeq === undefined || endSeq === undefined
      ? { kind: 'append', targetSeq }
      : { kind: 'replace', targetSeq, startSeq, endSeq, shadowedSeqs }
  }

  /**
   * The current surface position of the node standing in for one event: the
   * newest observed replacement that transitively shadowed it. A replacement
   * appended after the observation leaves no stand-in and fails rather than
   * committing a range the current surface no longer supports.
   * @param events - exact observed Session history.
   * @param nodes - current surface nodes.
   * @param sessionId - addressed Session identity for the failure details.
   * @param seq - event whose stand-in position is resolved.
   * @returns the stand-in's index in `nodes`.
   * @throws {RemoteError} `session/rewind-unavailable` when nothing kept it on the surface.
   */
  private surfaceStandInIndex(
    events: readonly SessionEvent[],
    nodes: readonly SessionSeq[],
    sessionId: SessionId,
    seq: SessionSeq,
  ): number {
    let cursor = seq
    for (const event of events) {
      if (!isReplacementSurfaceEvent(event) || event.sourceEventSeqs?.includes(cursor) !== true) continue
      cursor = event.seq
    }
    const index = nodes.indexOf(cursor)
    if (index === -1) {
      throw new RemoteError(
        'session/rewind-unavailable',
        `session "${sessionId}" no longer places seq ${String(seq)} on its surface`,
        { sessionId, targetSeq: seq },
      )
    }
    return index
  }

  /**
   * Append the durable retraction marker: an empty developer message that
   * derives no model-visible message, states the retracted target in its source
   * so clients can hide the range, and carries the replacement that removes the
   * resolved surface range.
   * @param session - Session receiving the marker.
   * @param plan - resolved surface placement for the retraction.
   * @param events - exact observed Session history supplying the marker coordinates.
   * @returns the committed marker event.
   */
  private appendRewindMarker(
    session: Session,
    plan: RewindPlan,
    events: readonly SessionEvent[],
  ): SessionEvent<'developer/message'> {
    const message = createDeveloperMessage({
      content: [],
      source: { kind: 'conversation-rewind', targetSeq: plan.targetSeq },
    })
    const data = { ...lastTurnStep(events), message }
    return plan.kind === 'append'
      ? session.append('developer/message', data, { surfaceOp: 'append' })
      : session.append('developer/message', data, {
        surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq },
        sourceEventSeqs: [...plan.shadowedSeqs],
      })
  }

  /**
   * Admit one prompt after Agent and attachment validation; the Remote method
   * has already validated the content and built the durable message source.
   * @param request - Session identity, prompt content, and delivery mode.
   * @param source - caller metadata recorded on the accepted ordinary or retry user message.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  async prompt(request: SessionPromptRequest, source: MessageSource): Promise<SessionPromptValue> {
    const agent = await this.resolveAgent(request.sessionId)
    if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
    if (request.content.length === 0) {
      try {
        return await agent.runMaintenance(() => {
          const inbox = agent.inbox
          if (request.mode !== 'queue' || this.continuation.stateOf(agent.session).ending === null
            || inbox.nextTurn.length > 0 || inbox.nextStep.some(message => message.source.kind === 'user')) {
            throw new RemoteError('session/agent-busy', 'generation continuation is unavailable', { reason: 'NO_CONTINUABLE_FAILURE_OR_PENDING_INPUT' })
          }
          agent.followup(createUserMessage({ content: [], source }))
          return Promise.resolve({ accepted: true as const })
        })
      } catch (error: unknown) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError('session/agent-busy', 'generation continuation was not accepted', { reason: String(error) })
      }
    }
    const admission = resolvePromptFileReceipts(
      request.content,
      receiptId => this.ctx.fileUploads.resolve(agent, receiptId),
    )
    // Encoded images and image upload receipts both make an image prompt.
    const hasImage = admission.content.some(part => part.type === 'image')
    const admit = async (): Promise<SessionPromptValue> => {
      try {
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        if (hasImage) {
          const current = agent.model.current()
          if (current !== undefined) {
            const model = await this.ctx.llm.resolveModelInfo(current.provider, current.model)
            if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
              throw new RemoteError(
                'session/attachment-invalid',
                `Model "${current.model}" does not support image input.`,
                { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
              )
            }
          }
        }
        const content = await this.ctx.attachments.admitPromptContent(admission.content)
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        const message: UserMessage = createUserMessage({ content, source })
        if (this.ctx.agents.get(agent.id) !== agent) {
          throw new RemoteError(
            'session/not-found',
            `session "${agent.id}" was disposed during prompt admission`,
            { sessionId: agent.id },
          )
        }
        using binding = this.ctx.fileUploads.bindPrompt(agent, admission.receiptIds, request.requestId)
        if (request.mode === 'steer') agent.steer(message)
        else agent.followup(message)
        binding.commit()
      } catch (error) {
        if (this.hasPromptRequest(agent.session, request.requestId)) return { accepted: true }
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof AttachmentError) {
          throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
        }
        throw new RemoteError('session/agent-busy', 'prompt rejected', { reason: String(error) })
      }
      return { accepted: true }
    }
    return hasImage ? this.agents.serializeImageAdmission(agent, admit) : admit()
  }

  /** Recover first input acceptance, including claimed or removed messages, from unseen log entries. */
  private hasPromptRequest(session: Session, requestId: SessionRequestId): boolean {
    let receipts = this.promptReceipts.get(session)
    if (receipts === undefined) {
      receipts = { offset: SessionLogOffset(0), messages: new Set(), requests: new Set() }
      this.promptReceipts.set(session, receipts)
    }
    if (receipts.offset !== session.seq) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing prompt retry history read, retained for acceptance recovery.
      for (const event of session.snapshotEvents(receipts.offset)) {
        if (event.type !== 'agent/inbox/spliced' && event.type !== 'user/message') continue
        const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted : [event.data]
        for (const message of messages) {
          if (receipts.messages.has(message.id)) continue
          receipts.messages.add(message.id)
          // A copied input is not a new request in the child, even if later reinserted there.
          if (event.seq < session.inheritedEventCount) continue
          const source = message.source
          if ((source.kind === 'user' || source.kind === 'retry') && 'rpcId' in source) receipts.requests.add(source.rpcId)
        }
      }
      receipts.offset = session.seq
    }
    return receipts.requests.has(requestId)
  }

  private async requireModel(selection: Pick<AgentModelSelection, 'provider' | 'model'>): Promise<void> {
    if (!await modelAvailable(this.ctx, selection)) {
      throw new RemoteError('session/model-unavailable', 'Select an available model before sending a message.',
        { provider: selection.provider, model: selection.model })
    }
  }

  /**
   * Read one durable image using the supplied reference without consulting Session history.
   * @param request - image reference and gateway permission scope; Session existence is not checked.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    try {
      const stored = await this.ctx.attachments.readImage(request.attachment)
      return {
        attachment: stored.ref,
        data: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new RemoteError('gateway/internal', 'Unable to read image attachment.', {})
    }
  }

  /**
   * Mutate one pending Inbox occurrence, restoring an ordinary cold Agent when needed.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  async updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    if (request.action.kind === 'edit') {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Remote callers can submit untyped JSON.
      if (request.action.content.some(block => block.type !== 'text')) {
        throw new RemoteError(
          'session/attachment-invalid',
          'queue edits accept text content only',
          { reason: 'QUEUE_EDIT_NON_TEXT' },
        )
      }
      if (!hasPromptContent(request.action.content)) {
        throw new RemoteError(
          'gateway/bad-request',
          'queue edit content must include non-whitespace text',
          {},
        )
      }
    }
    let agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      const found = await this.agents.resolveAgent(request.sessionId)
      if ('error' in found) {
        if (found.error.code !== 'session/not-found') throw found.error
        throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
      }
      agent = found.agent
    }
    if (hasApiSessionSubagentOwner(agent.session)) {
      const identity = this.ctx.sessionProjections
        .snapshot(agent.session, ['subagent'])
        .values.subagent
      if (identity?.mode !== 'continuable'
        || !agent.session.isOwnSeq(identity.seq)) {
        throw apiSessionSubagentOwnershipError(request.sessionId)
      }
    }
    const nextTurn = agent.inbox.nextTurn.find(message => message.id === request.itemId)
    const nextStep = agent.inbox.nextStep.find(message => message.id === request.itemId)
    const located = nextTurn === undefined
      ? nextStep === undefined ? undefined : { target: 'next-step' as const, message: nextStep }
      : { target: 'next-turn' as const, message: nextTurn }
    if (located === undefined) {
      throw new RemoteError('session/queue-item-not-found', 'queued item is no longer pending', { itemId: request.itemId })
    }
    const { target, message } = located
    if (request.action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
      throw new RemoteError('session/steer-unavailable', 'current turn no longer accepts steering', { itemId: request.itemId })
    }
    switch (request.action.kind) {
      case 'edit':
        agent.inbox.replace(request.itemId, freezeMessage<UserMessage>({
          ...message,
          content: [...request.action.content],
        }))
        break
      case 'remove': {
        agent.inbox.remove(request.itemId)
        const source = message.source
        if (source.kind === 'user' && 'rpcId' in source) {
          this.ctx.fileUploads.retirePrompt(agent, source.rpcId)
        }
        break
      }
      case 'steer':
        agent.inbox.remove(request.itemId)
        agent.steer(message)
        break
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        assertNever(request.action, 'queue action')
    }
    return { accepted: true }
  }

  /**
   * Cancel one live ordinary Agent while retaining pending inbox work.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  cancel(request: SessionCancelRequest): SessionCancelValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'session/not-found',
        `session "${request.sessionId}" not found (not attached)`,
        { sessionId: request.sessionId },
      )
    }
    if (hasApiSessionSubagentOwner(agent.session)) {
      throw apiSessionSubagentOwnershipError(request.sessionId)
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { accepted: true }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private rejectCreation(error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof ApiSessionPresetConflict) {
      throw new RemoteError('agent-preset/conflict', error.message, {
        sessionId: error.sessionId,
        requestedPreset: error.requestedPreset,
      })
    }
    if (error instanceof ApiSessionCwdConflict) {
      throw new RemoteError('session/conflict', error.message, {
        sessionId: error.sessionId,
        requestedCwd: error.requestedCwd,
        ...(error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd }),
      })
    }
    if (error instanceof ApiSessionSubagentOwnership) {
      throw apiSessionSubagentOwnershipError(error.sessionId)
    }
    throw new RemoteError('gateway/internal', `failed to create session: ${String(error)}`, {})
  }

  private async forkWorkspace(source: SessionHeader): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.origin !== 'subagent') return direct
    const lineage = await this.ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }
}

/** Replace each file part with the file or image its staged receipt names. */
function resolvePromptFileReceipts(
  content: SessionPromptRequest['content'],
  staged: (receiptId: FileUploadReceiptId) => StagedAttachment | undefined,
): { readonly content: AttachmentAdmissionPart[]; readonly receiptIds: readonly FileUploadReceiptId[] } {
  const receiptIds = new Set<FileUploadReceiptId>()
  const resolved = content.map((part): AttachmentAdmissionPart => {
    if (part.type !== 'file') return part
    const attachment = staged(part.receiptId)
    if (attachment === undefined) {
      throw new RemoteError(
        'session/attachment-invalid',
        'File was not uploaded for this session.',
        { reason: 'FILE_NOT_STAGED' },
      )
    }
    receiptIds.add(part.receiptId)
    return attachment
  })
  return { content: resolved, receiptIds: [...receiptIds] }
}
