/**
 * Files workbench, host half: the working-tree and history git routes its git
 * view reads.
 *
 * The routes sit inside Connection's authentication fence, resolve the Session
 * header from the id the browser sent without activating the Session's agent,
 * and refuse a working directory that differs from the one the Session header
 * recorded. That check binds a request to a Session the Host knows; it does not
 * bind it to the Session the requesting browser is viewing, because every
 * browser connection shares one authenticated owner peer, so any tab may read
 * any listed Session's working directory. They add no git code of their own:
 * the `workspaceChanges` service owns the runner and the comparison.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import {
  GIT_COMMIT_DIFF_PATH, GIT_COMMIT_PATH, GIT_DIFF_PATH, GIT_HISTORY_PATH, GIT_REFS_PATH, GIT_STATUS_PATH,
  HISTORY_PAGE_SIZE,
} from './git.ts'

/** Services the git routes read. */
export const inject = ['connection', 'sessions', 'workspaceChanges']

/** Headers for every answer, so no refusal is cached. */
const NO_STORE = { 'cache-control': 'no-store' }

/** Largest commit offset the route accepts; `git log --skip` parses its value as a C int. */
const MAX_HISTORY_SKIP = 2_147_483_647

/**
 * Longest ref name the history route accepts. Git stores each component under
 * the filesystem's name limit, so a deep ref can run to several hundred
 * characters; this bound only keeps an oversized query out of the argv.
 */
const MAX_REF_LENGTH = 1024

/** A commit hash the routes accept: an abbreviated or full object id. */
const COMMIT_HASH = /^[0-9a-f]{4,64}$/u

/** A history walk's ref: one of the three namespaces `git for-each-ref` lists. */
const FULL_REF = /^refs\/(?:heads|remotes|tags)\/\S+$/u

/**
 * Whether one browser-supplied ref name is one the history route reads.
 *
 * The request names the full ref, because a branch and a tag can share a
 * display name and a bare name resolves to the tag. The workspace-changes
 * service re-checks the name against the repository's refs; this guard keeps
 * option-like, control-character, and invalid-grammar values from reaching git.
 * @param ref - the query value.
 * @returns whether the name has the form of a full git ref.
 */
function refName(ref: string): boolean {
  return ref.length <= MAX_REF_LENGTH && FULL_REF.test(ref)
    && !ref.includes('..') && !ref.includes('@{') && !/[\p{Cc}\p{Z}\\~^:]/u.test(ref)
}

/**
 * One query parameter parsed as a plain non-negative decimal integer.
 * @param raw - the query value.
 * @returns the integer, or undefined when the value is not one.
 */
function countParameter(raw: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * One comparison's `complete` flag: whether the whole file was asked for.
 * @param raw - the query value, absent when the request names no scope.
 * @returns true for the whole file, false for the changed hunks only, or
 *   undefined when the value is not one the route accepts.
 */
function completeFlag(raw: string | null): boolean | undefined {
  if (raw === null) return false
  return raw === '1' ? true : undefined
}

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
 * it never resumes or retains the Session's agent. The returned directory is
 * the one that Session resolved, not one the caller proved a right to: the
 * routes sit behind the connection's authentication, and every browser peer
 * shares one owner, so this check binds the request to a Session the Host knows
 * rather than to the Session the requesting tab is viewing.
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
 * Register the git routes.
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
      const complete = completeFlag(query.get('complete'))
      if (complete === undefined || !inside(cwd, path) || (from !== undefined && !inside(cwd, from))) {
        return refusal('Invalid git path.', 400)
      }
      const comparison = await ctx.workspaceChanges.workingDiff(
        cwd, { path, complete, ...(from === undefined ? {} : { from }) }, scope(request),
      )
      return comparison === undefined
        ? refusal('Comparison unavailable.', 404)
        : Response.json(comparison, { headers: NO_STORE })
    },
  })
  ctx.connection.fetch.register({
    path: GIT_REFS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      // A failed read is the Host's, not the browser's: the view can retry it.
      try {
        return Response.json(await ctx.workspaceChanges.historyRefs(cwd, scope(request)), { headers: NO_STORE })
      } catch (error) {
        ctx.logger.warn(`git refs read in ${cwd} failed`, error)
        return refusal('Refs unavailable.', 503)
      }
    },
  })
  ctx.connection.fetch.register({
    path: GIT_HISTORY_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      const query = new URL(request.url).searchParams
      const rawRef = query.get('ref')
      if (rawRef !== null && !refName(rawRef)) return refusal('Invalid git ref.', 400)
      const rawSkip = query.get('skip')
      const skip = rawSkip === null ? 0 : countParameter(rawSkip)
      const rawLimit = query.get('limit')
      const limit = rawLimit === null ? HISTORY_PAGE_SIZE : countParameter(rawLimit)
      // The service clamps an oversized page to its configured `maxCommits`, so
      // the route bounds only the shape: a positive safe integer.
      if (skip === undefined || skip > MAX_HISTORY_SKIP || limit === undefined || limit < 1) {
        return refusal('Invalid history page.', 400)
      }
      const page = rawRef === null ? { skip, limit } : { ref: rawRef, skip, limit }
      try {
        return Response.json(await ctx.workspaceChanges.history(cwd, page, scope(request)), { headers: NO_STORE })
      } catch (error) {
        // The cause stays on the Host: the browser only needs the retry state.
        ctx.logger.warn(`git history read in ${cwd} failed`, error)
        return refusal('History unavailable.', 503)
      }
    },
  })
  ctx.connection.fetch.register({
    path: GIT_COMMIT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      const hash = new URL(request.url).searchParams.get('hash') ?? ''
      if (!COMMIT_HASH.test(hash)) return refusal('Invalid commit hash.', 400)
      try {
        const detail = await ctx.workspaceChanges.commit(cwd, hash, scope(request))
        return detail === undefined
          ? refusal('Commit unavailable.', 404)
          : Response.json(detail, { headers: NO_STORE })
      } catch (error) {
        ctx.logger.warn(`git commit read in ${cwd} failed`, error)
        return refusal('Commit unavailable.', 503)
      }
    },
  })
  ctx.connection.fetch.register({
    path: GIT_COMMIT_DIFF_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const cwd = await worktreeOf(ctx, request)
      if (cwd instanceof Response) return cwd
      const query = new URL(request.url).searchParams
      const hash = query.get('hash') ?? ''
      const path = query.get('path') ?? ''
      const from = query.get('from') ?? undefined
      const complete = completeFlag(query.get('complete'))
      if (complete === undefined || !COMMIT_HASH.test(hash) || !inside(cwd, path)
        || (from !== undefined && !inside(cwd, from))) {
        return refusal('Invalid commit comparison.', 400)
      }
      try {
        const comparison = await ctx.workspaceChanges.commitDiff(
          cwd, { hash, path, complete, ...(from === undefined ? {} : { from }) }, scope(request),
        )
        return comparison === undefined
          ? refusal('Comparison unavailable.', 404)
          : Response.json(comparison, { headers: NO_STORE })
      } catch (error) {
        ctx.logger.warn(`git commit comparison in ${cwd} failed`, error)
        return refusal('Comparison unavailable.', 503)
      }
    },
  })
}
