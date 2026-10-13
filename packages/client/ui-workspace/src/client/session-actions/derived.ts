/** Derived observable sources and shared failure readers for the row actions' injected hooks. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionDeleteError } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace/types'

/**
 * Project one observable into another, recomputing only when the source
 * snapshot changes identity, so consumers that select from the projection
 * (a Set lookup per row) never rebuild it per read.
 * @param source - the observable to project.
 * @param project - pure projection of one source snapshot.
 * @returns the projected observable, subscribing through the source.
 */
export function derive<S, T>(source: HostObservable<S>, project: (snapshot: S) => T): HostObservable<T> {
  let seen: S | undefined
  let value: T | undefined
  return {
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (value === undefined || snapshot !== seen) {
        seen = snapshot
        value = project(snapshot)
      }
      return value
    },
    subscribe: listener => source.subscribe(listener),
  }
}

/**
 * The activity a Host `session/active` refusal reported, or nothing for any
 * other failure. The class check goes by name because client plugin bundles
 * do not share error-class identity, and the reading lives here rather than
 * in the action so the navigation service can answer the same refusal.
 * @param reason - the rejection a deletion raised.
 * @returns the running work the Host reported, or undefined for any other failure.
 */
export function activeSessionDeletionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'SessionDeleteError') return undefined
  const { rpcError } = reason as SessionDeleteError
  return rpcError.code === 'session/active' ? rpcError.details.activity : undefined
}
