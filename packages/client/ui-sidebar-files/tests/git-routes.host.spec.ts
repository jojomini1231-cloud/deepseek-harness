/**
 * The Files workbench's host half: the git routes it registers and the checks
 * they run before reading anything.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

describe('ui-sidebar-files host half', () => {
  it('serves the working-tree git routes behind the Session and path checks', async () => {
    const ctx = new Context()
    const routes = new Map<string, (request: Request) => Promise<Response>>()
    const disposers: Array<() => void> = []
    ctx.provide('connection', {
      fetch: {
        register: (options: { path: string; fetch: (request: Request) => Promise<Response> }) => {
          routes.set(options.path, options.fetch)
          const off = (): void => { routes.delete(options.path) }
          disposers.push(off)
          return off
        },
      },
    } as never)
    const get = vi.fn((id: string) => id === 's-1' ? { header: { id, cwd: '/work/app' } } : undefined)
    ctx.provide('sessions', { get } as never)
    const stat = vi.fn(async (id: string) => id === 's-3' ? { header: { id, cwd: '/work/app' } } : undefined)
    ctx.provide('sessionPersistence', { stat } as never)
    const workingTree = vi.fn(async () => ({ kind: 'repository', branch: 'main', entries: [], total: 0 }))
    const workingDiff = vi.fn(async () => ({ kind: 'binary', path: 'a.bin', display: 'a.bin' }))
    ctx.provide('workspaceChanges', { workingTree, workingDiff } as never)
    apply(ctx)
    const status = routes.get('/api/git.status')!
    const diff = routes.get('/api/git.diff')!
    const call = (handler: (request: Request) => Promise<Response>, query: string): Promise<Response> =>
      handler(new Request(`http://localhost/api/git?${query}`))
    // Missing coordinates are refused before any Session read, and every refusal
    // is uncached.
    for (const query of ['', 'cwd=%2Fwork%2Fapp', 'sessionId=s-1', 'sessionId=&cwd=%2Fwork%2Fapp']) {
      const refused = await call(status, query)
      expect(refused.status).toBe(400)
      expect(refused.headers.get('cache-control')).toBe('no-store')
    }
    // An unknown Session, and a working directory the Session did not resolve.
    const unknown = await call(status, 'sessionId=s-2&cwd=%2Fwork%2Fapp')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('cache-control')).toBe('no-store')
    expect(stat).toHaveBeenCalledWith('s-2', expect.anything())
    const mismatch = await call(status, 'sessionId=s-1&cwd=%2Felsewhere')
    expect(mismatch.status).toBe(409)
    expect(mismatch.headers.get('cache-control')).toBe('no-store')
    // A Session without a live agent resolves from its stored header.
    expect((await call(status, 'sessionId=s-3&cwd=%2Fwork%2Fapp')).status).toBe(200)
    expect(workingTree).toHaveBeenLastCalledWith('/work/app', expect.anything())
    // A resolved status is served without storing it.
    const answer = await call(status, 'sessionId=s-1&cwd=%2Fwork%2Fapp')
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toEqual({ kind: 'repository', branch: 'main', entries: [], total: 0 })
    expect(workingTree).toHaveBeenCalledWith('/work/app', expect.anything())
    // The comparison route runs the same Session and working-directory checks.
    expect((await call(diff, 'sessionId=s-2&cwd=%2Fwork%2Fapp&path=a.bin')).status).toBe(404)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Felsewhere&path=a.bin')).status).toBe(409)
    // A path that escapes the working directory never reaches the comparison.
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=..%2Fsecret')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=%2Fetc%2Fpasswd')).status).toBe(400)
    // The working directory itself is not a changed path.
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=.')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=.')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=..%2Fsecret')).status).toBe(400)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=%2Fetc%2Fpasswd')).status).toBe(400)
    // The scope parameter names the whole file only as `1`; any other spelling is refused.
    for (const complete of ['complete=0', 'complete=true', 'complete=', 'complete=yes']) {
      expect((await call(diff, `sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&${complete}`)).status, complete).toBe(400)
    }
    const comparison = await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin')
    expect(comparison.status).toBe(200)
    expect(await comparison.json()).toEqual({ kind: 'binary', path: 'a.bin', display: 'a.bin' })
    expect(workingDiff).toHaveBeenLastCalledWith('/work/app', { path: 'a.bin', complete: false }, expect.anything())
    // A rename carries its origin so the comparison pairs the two paths.
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=old.bin')).status).toBe(200)
    expect(workingDiff).toHaveBeenLastCalledWith(
      '/work/app', { path: 'a.bin', complete: false, from: 'old.bin' }, expect.anything(),
    )
    // `complete=1` asks for the whole file rather than the changed hunks.
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&complete=1')).status).toBe(200)
    expect(workingDiff).toHaveBeenLastCalledWith('/work/app', { path: 'a.bin', complete: true }, expect.anything())
    // A refused comparison is a 404, and the route lifetime ends with the plugin.
    workingDiff.mockResolvedValueOnce(undefined as never)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin')).status).toBe(404)
    for (const off of disposers) off()
    expect(routes.size).toBe(0)
  })

  it('registers every git route in order and removes them with the plugin', async () => {
    const ctx = new Context()
    const paths: string[] = []
    const disposers: Array<() => void> = []
    ctx.provide('connection', {
      fetch: {
        register: (options: { path: string }) => {
          paths.push(options.path)
          const off = (): void => { paths.splice(paths.indexOf(options.path), 1) }
          disposers.push(off)
          return off
        },
      },
    } as never)
    ctx.provide('sessions', {
      get: (id: string) => ({ header: { id, cwd: '/work/app' } }),
    } as never)
    ctx.provide('workspaceChanges', {
      workingTree: async () => ({ kind: 'repository', entries: [], total: 0 }),
      workingDiff: async () => undefined,
      historyRefs: async () => [],
      history: async () => ({ commits: [], hasMore: false }),
      commit: async () => undefined,
      commitDiff: async () => undefined,
    } as never)
    apply(ctx)
    expect(paths).toEqual([
      '/api/git.status', '/api/git.diff', '/api/git.refs', '/api/git.history', '/api/git.commit', '/api/git.commit-diff',
    ])
    // Disposing the plugin aborts the lifetime its route reads share.
    await ctx.fiber.dispose()
    for (const off of disposers) off()
    expect(paths).toEqual([])
  })

  it('serves the history routes with validated coordinates and parameters', async () => {
    const ctx = new Context()
    const routes = new Map<string, (request: Request) => Promise<Response>>()
    const disposers: Array<() => void> = []
    ctx.provide('connection', {
      fetch: {
        register: (options: { path: string; fetch: (request: Request) => Promise<Response> }) => {
          routes.set(options.path, options.fetch)
          const off = (): void => { routes.delete(options.path) }
          disposers.push(off)
          return off
        },
      },
    } as never)
    ctx.provide('sessions', { get: (id: string) => id === 's-1' ? { header: { id, cwd: '/work/app' } } : undefined } as never)
    ctx.provide('sessionPersistence', { stat: async () => undefined } as never)
    const refs = [{ name: 'main', kind: 'local', hash: 'a'.repeat(40), head: true }]
    const page = { commits: [], hasMore: false }
    const detail = {
      commit: {
        hash: 'a'.repeat(40), short: 'aaaaaaa', parents: [], author: 't',
        authoredAt: '2026-01-01T00:00:00+00:00', subject: 'one',
      },
      message: 'one',
      files: [],
      total: 0,
    }
    const historyRefs = vi.fn(async () => refs)
    const history = vi.fn(async () => page)
    const commit = vi.fn(async () => detail)
    const commitDiff = vi.fn(async () => ({ kind: 'binary', path: 'a.bin', display: 'a.bin' }))
    ctx.provide('workspaceChanges', { historyRefs, history, commit, commitDiff } as never)
    apply(ctx)
    const call = (path: string, query: string): Promise<Response> =>
      routes.get(path)!(new Request(`http://localhost${path}?${query}`))
    const coordinates = 'sessionId=s-1&cwd=%2Fwork%2Fapp'
    // The Session and working-directory checks guard every history route too.
    for (const [path, extra] of [
      ['/api/git.refs', ''],
      ['/api/git.history', ''],
      ['/api/git.commit', 'hash=abcdef'],
      ['/api/git.commit-diff', 'hash=abcdef&path=a.bin'],
    ] as const) {
      expect((await call(path, '')).status).toBe(400)
      expect((await call(path, 'sessionId=s-2&cwd=%2Fwork%2Fapp')).status).toBe(404)
      expect((await call(path, `sessionId=s-1&cwd=%2Felsewhere&${extra}`)).status).toBe(409)
    }

    // The refs route serves what the service lists.
    const refsAnswer = await call('/api/git.refs', coordinates)
    expect(refsAnswer.status).toBe(200)
    expect(refsAnswer.headers.get('cache-control')).toBe('no-store')
    expect(await refsAnswer.json()).toEqual(refs)
    expect(historyRefs).toHaveBeenCalledWith('/work/app', expect.anything())
    historyRefs.mockRejectedValueOnce(new Error('git failed'))
    const refsFailure = await call('/api/git.refs', coordinates)
    expect(refsFailure.status).toBe(503)
    expect(refsFailure.headers.get('cache-control')).toBe('no-store')

    // A history page defaults to the first fifty commits without a ref.
    expect((await call('/api/git.history', coordinates)).status).toBe(200)
    expect(history).toHaveBeenLastCalledWith('/work/app', { skip: 0, limit: 50 }, expect.anything())
    expect(await (await call('/api/git.history', `${coordinates}&skip=2&limit=3`)).json()).toEqual(page)
    expect(history).toHaveBeenLastCalledWith('/work/app', { skip: 2, limit: 3 }, expect.anything())
    expect((await call('/api/git.history', `${coordinates}&ref=refs%2Fremotes%2Forigin%2Fdev`)).status).toBe(200)
    expect(history).toHaveBeenLastCalledWith(
      '/work/app', { ref: 'refs/remotes/origin/dev', skip: 0, limit: 50 }, expect.anything(),
    )
    // A page size above any default reaches the service unchanged: the service
    // clamps it to its configured `maxCommits`, so the route holds no ceiling of
    // its own that an operator's larger setting could contradict.
    expect((await call('/api/git.history', `${coordinates}&ref=refs%2Ftags%2Fv1.0.0&skip=0&limit=5000`)).status)
      .toBe(200)
    expect(history).toHaveBeenLastCalledWith(
      '/work/app', { ref: 'refs/tags/v1.0.0', skip: 0, limit: 5000 }, expect.anything(),
    )
    // A full ref spelling never begins with `-`, so a legal ref such as
    // `refs/heads/-h` is walkable rather than read as an option.
    expect((await call('/api/git.history', `${coordinates}&ref=refs%2Fheads%2F-h`)).status).toBe(200)
    for (const query of [
      'skip=abc', 'skip=-1', 'skip=', 'skip=1.5', 'skip=01', 'skip=2147483648', 'skip=99999999999999999999',
      'limit=0', 'limit=abc', 'limit=', 'limit=99999999999999999999',
      // A ref is named by its full spelling: a bare display name, an unknown
      // namespace, an option-like name, and bad grammar are all refused.
      'ref=', 'ref=dev', 'ref=-h', 'ref=refs%2Fheads%2Fwith%20space', 'ref=refs%2Fheads%2F..%2Fescape',
      'ref=refs%2Fheads%2Fat%40%7Bbrace', 'ref=refs%2Fnotes%2Fn', 'ref=refs%2Fheads%2F', `ref=refs%2Fheads%2F${'a'.repeat(1024)}`,
      'ref=%00',
    ]) {
      const refused = await call('/api/git.history', `${coordinates}&${query}`)
      expect(refused.status, query).toBe(400)
      expect(refused.headers.get('cache-control')).toBe('no-store')
    }
    history.mockRejectedValueOnce(new Error('git failed'))
    expect((await call('/api/git.history', coordinates)).status).toBe(503)

    // One commit detail answers 404 when the service knows no such commit.
    const commitAnswer = await call('/api/git.commit', `${coordinates}&hash=${'a'.repeat(40)}`)
    expect(commitAnswer.status).toBe(200)
    expect(await commitAnswer.json()).toEqual(detail)
    expect(commit).toHaveBeenLastCalledWith('/work/app', 'a'.repeat(40), expect.anything())
    expect((await call('/api/git.commit', `${coordinates}&hash=abcdef`)).status).toBe(200)
    for (const query of ['', 'hash=', 'hash=ABC', 'hash=abc', 'hash=zzzz', `hash=${'a'.repeat(65)}`]) {
      expect((await call('/api/git.commit', `${coordinates}&${query}`)).status, query).toBe(400)
    }
    commit.mockResolvedValueOnce(undefined as never)
    expect((await call('/api/git.commit', `${coordinates}&hash=${'a'.repeat(40)}`)).status).toBe(404)
    commit.mockRejectedValueOnce(new Error('git failed'))
    expect((await call('/api/git.commit', `${coordinates}&hash=${'a'.repeat(40)}`)).status).toBe(503)

    // A commit file comparison pairs a rename's paths and keeps both inside the working directory.
    const diffAnswer = await call('/api/git.commit-diff', `${coordinates}&hash=abcdef&path=a.bin&from=old.bin`)
    expect(diffAnswer.status).toBe(200)
    expect(await diffAnswer.json()).toEqual({ kind: 'binary', path: 'a.bin', display: 'a.bin' })
    expect(commitDiff).toHaveBeenLastCalledWith(
      '/work/app', { hash: 'abcdef', path: 'a.bin', complete: false, from: 'old.bin' }, expect.anything(),
    )
    // `complete=1` reaches the service; any other spelling of the scope is refused.
    expect((await call('/api/git.commit-diff', `${coordinates}&hash=abcdef&path=a.bin&complete=1`)).status).toBe(200)
    expect(commitDiff).toHaveBeenLastCalledWith(
      '/work/app', { hash: 'abcdef', path: 'a.bin', complete: true }, expect.anything(),
    )
    for (const query of [
      '', 'hash=abcdef', 'path=a.bin', 'hash=zzzz&path=a.bin', 'hash=abcdef&path=..%2Fescape',
      'hash=abcdef&path=%2Fetc%2Fpasswd', 'hash=abcdef&path=.', 'hash=abcdef&path=a.bin&from=',
      'hash=abcdef&path=a.bin&from=..%2Fescape', 'hash=abcdef&path=a.bin&from=%2Fetc%2Fpasswd',
      'hash=abcdef&path=a.bin&complete=0', 'hash=abcdef&path=a.bin&complete=true', 'hash=abcdef&path=a.bin&complete=',
    ]) {
      expect((await call('/api/git.commit-diff', `${coordinates}&${query}`)).status, query).toBe(400)
    }
    commitDiff.mockResolvedValueOnce(undefined as never)
    expect((await call('/api/git.commit-diff', `${coordinates}&hash=abcdef&path=a.bin`)).status).toBe(404)
    commitDiff.mockRejectedValueOnce(new Error('git failed'))
    expect((await call('/api/git.commit-diff', `${coordinates}&hash=abcdef&path=a.bin`)).status).toBe(503)
    for (const off of disposers) off()
    expect(routes.size).toBe(0)
  })
})
