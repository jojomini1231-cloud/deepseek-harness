/**
 * Files workbench, host half: the working-tree git routes its git view reads.
 *
 * The routes sit inside Connection's authentication fence, resolve the Session
 * header from the id the browser sent without activating the Session's agent,
 * and refuse a working directory that differs from the one the Session header
 * recorded. They add no git code of their own: the `workspaceChanges` service
 * owns the runner and the comparison.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { GIT_DIFF_PATH, GIT_STATUS_PATH } from './git.ts'

/** Services the git routes read. */
export const inject = ['connection', 'sessions', 'workspaceChanges']

/** Headers for every answer, so no refusal is cached. */
const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Refuse one request with a plain-text reason.
 * @param text - the reason shown to the client.
 * @param status - the HTTP status.
 * @returns the response.
 */
function refusal(text: string, status: number): Response {
  return new Response(text, { status, headers: NO_STORE })
}

/**
 * Whether one relative path stays inside the working directory.
 * @param cwd - the Session working directory.
 * @param path - the browser-supplied path.
 * @returns whether resolving `path` stays under `cwd`.
 */
function inside(cwd: string, path: string): boolean {
  if (path === '' || isAbsolute(path)) return false
  // Both sides share `cwd`'s root, so the relative result is never absolute.
  const rel = relative(cwd, resolve(cwd, path))
  return rel !== '' && !rel.startsWith('..')
}

/**
 * Resolve the working directory the browser echoed, or explain why it is refused.
 *
 * The lookup reads the live Session header first and the stored header second;
 * it never resumes or retains the Session's agent.
 * @param ctx - host context carrying the Session services.
 * @param request - the authenticated request.
 * @returns the verified working directory, or the response to send instead.
 */
async function worktreeOf(ctx: Context, request: Request): Promise<string | Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const cwd = query.get('cwd')
  if (id === null || id === '' || cwd === null || cwd === '') {
    return refusal('Invalid git coordinates.', 400)
  }
  const sessionId = id as SessionId
  const live = ctx.sessions.get(sessionId)?.header
  const stored = live === undefined
    ? await ctx.get('sessionPersistence')?.stat(sessionId, { signal: request.signal })
    : undefined
  const header = live ?? stored?.header
  if (header === undefined) return refusal('Session unavailable.', 404)
  if (header.cwd !== cwd) return refusal('Working directory mismatch.', 409)
  return cwd
}

/**
 * Register the working-tree git routes.
 * @param ctx - host context carrying Connection and the changes service.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'ui-sidebar-files: git route lifetime')
  const scope = (request: Request): AbortSignal => AbortSignal.any([request.signal, lifetime.signal])
  ctx.connection.fetch.register({
    path: GIT_STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      const status = await ctx.workspaceChanges.workingTree(cwd, scope(request))
      return Response.json(status, { headers: NO_STORE })
    },
  })
  ctx.connection.fetch.register({
    path: GIT_DIFF_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      const query = new URL(request.url).searchParams
      const path = query.get('path') ?? ''
      const from = query.get('from') ?? undefined
      if (!inside(cwd, path) || (from !== undefined && !inside(cwd, from))) {
        return refusal('Invalid git path.', 400)
      }
      const comparison = await ctx.workspaceChanges.workingDiff(
        cwd, from === undefined ? { path } : { path, from }, scope(request),
      )
      return comparison === undefined
        ? refusal('Comparison unavailable.', 404)
        : Response.json(comparison, { headers: NO_STORE })
    },
  })
}
