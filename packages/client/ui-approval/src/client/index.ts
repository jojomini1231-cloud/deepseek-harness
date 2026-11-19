/** Browser approval consumer over the existing scoped Remote Event waterfall. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { ApprovalCard } from './ApprovalCard.tsx'
import { ApprovalInbox } from './ApprovalInbox.tsx'
import type { ApprovalInboxInjected } from './ApprovalInbox.tsx'
import { ApprovalPeek } from './ApprovalPeek.tsx'
import type { ApprovalPeekInjected } from './ApprovalPeek.tsx'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { approvalPayload } from './approval-detail.ts'
import { PendingApproval } from './contract/slots.ts'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

export type {
  ApprovalCardInput,
  ApprovalComposerProps,
  ApprovalDecision,
  ApprovalDetailOwnerProps,
  ApprovalPresentationRequest,
  PendingApproval,
} from './contract/slots.ts'
export type { ApprovalKey } from './locales.ts'

/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale', 'uiWorkspace']

const NS = 'approval'

type ApprovalListener = TypertClientEventListener<'approval/request'>
type ClientApprovalRequest = Parameters<ApprovalListener>[0]
type ClientApprovalNext = Parameters<ApprovalListener>[1]
type ClientApprovalOutcome = Awaited<ReturnType<ApprovalListener>>

/* jscpd:ignore-start -- Approval and Question intentionally mirror one Remote waterfall lifecycle. */
/** Present one request until the user answers or its lifetime ends. */
async function answerApproval(
  ctx: ClientContext,
  owner: ClientContext,
  request: ClientApprovalRequest,
  next: ClientApprovalNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingApproval>,
): Promise<ClientApprovalOutcome> {
  const sessionId = ctx.sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const pending = new PendingApproval(sessionId, {
    toolName: request.toolName,
    ...(request.callId === undefined
      ? {}
      : { callId: request.callId }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.displayReason === undefined ? {} : { displayReason: request.displayReason }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const completed = Promise.withResolvers<void>()
  const remove = registerPendingInteraction(pending, async () => {
    pending.delegate()
    await completed.promise
  })
  try {
    try {
      return await pending.result
    } catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    completed.resolve()
  }
}
/* jscpd:ignore-end */

/**
 * Install approval copy and the scoped waterfall consumer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const resolveDetail = approvalPayload(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-approval: dictionaries')
  ctx.inject(['shortcuts'], (scope) => {
    const t = ctx.locale.bind(NS)
    scope.effect(() => scope.shortcuts.registerFixed({
      id: 'approval.allow' as ShortcutCommandId, label: () => t('allow'), keys: ['Enter'], bindings: [{ code: 'Enter', modifiers: [] }], group: 'approval',
    }), 'ui-approval: fixed allow reference')
    scope.effect(() => scope.shortcuts.registerFixed({
      id: 'approval.reject' as ShortcutCommandId, label: () => t('reject'), keys: ['Esc'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'approval',
    }), 'ui-approval: fixed reject reference')
  })
  const registerPendingInteraction = ctx.uiSession.registerPendingInteraction<PendingApproval>(
    () => 0,
  )
  ctx.slots.registerFactory({
    name: 'conversation.approval.card', scope: 'session', locale: NS,
    children: { 'conversation.approval.detail': { kind: 'single', scope: 'session' } },
  }, ApprovalCard)
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: 1,
    select: ({ pendingInteraction }: ComposerChainProps): PendingApproval | null =>
      pendingInteraction instanceof PendingApproval ? pendingInteraction : null,
    locale: NS,
    inject: () => ({
      resolveReason: (reason: NonNullable<PendingApproval['displayReason']>) => ctx.locale.resolveText(reason),
    }),
  }, ApprovalPanel))
  // The sidebar row's hover card answers in place, so a background Session can
  // be decided without opening it.
  ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
    name: 'sidebar.session.row.hover',
    id: 'approval.peek',
    locale: NS,
    inject: (): ApprovalPeekInjected => ({
      hooks: { pending: ctx.uiSession.pendingInteractions },
      resolveReason: reason => ctx.locale.resolveText(reason),
      openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
      resolveDetail,
    }),
  }, ApprovalPeek))
  // The frame overlay drains approvals queued across every Session at once.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'approval.inbox',
    locale: NS,
    inject: (): ApprovalInboxInjected => ({
      hooks: { pending: ctx.uiSession.pendingInteractions },
      resolveReason: reason => ctx.locale.resolveText(reason),
      resolveDetail,
    }),
  }, ApprovalInbox))
  ctx.remote.$on('approval/request', function (request, next) {
    return answerApproval(ctx, this, request, next, registerPendingInteraction)
  })
}
