/** Document view state belongs to view lifetimes, including while their bodies are hidden. */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Release retained view state when its lifetime ends or the plugin is disposed.
 * @param ctx - owning preview plugin context.
 * @returns a callback accepting the view, its lifetime signal, and its store's
 * forget action; one listener per (signal, view), shared by repeated holds.
 */
export function retainDocumentViews(ctx: Context): (viewKey: string, signal: AbortSignal, forget: (viewKey: string) => void) => void {
  // One abort listener per signal, holding the forget calls of every view that
  // signal owns: several views may share one signal — a workbench tab's chips —
  // and each view forgets only its own bucket.
  const retained = new Map<AbortSignal, Map<string, () => void>>()
  ctx.effect(() => () => {
    for (const views of retained.values()) for (const forget of views.values()) forget()
  })
  return (viewKey, signal, forgetView) => {
    if (signal.aborted) { forgetView(viewKey); return }
    const views = retained.get(signal) ?? new Map<string, () => void>()
    retained.set(signal, views)
    if (views.has(viewKey)) return
    views.set(viewKey, () => { forgetView(viewKey) })
    if (views.size === 1) {
      // The listener reads the set at abort time, so views joined later are
      // covered without arming another listener.
      signal.addEventListener('abort', () => {
        retained.delete(signal)
        for (const forget of views.values()) forget()
        views.clear()
      }, { once: true })
    }
  }
}
