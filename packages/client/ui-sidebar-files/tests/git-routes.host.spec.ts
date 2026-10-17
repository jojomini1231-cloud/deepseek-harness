/**
 * The Files workbench's host half: the working-tree git routes it registers and
 * the checks they run before reading anything.
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
    const comparison = await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin')
    expect(comparison.status).toBe(200)
    expect(await comparison.json()).toEqual({ kind: 'binary', path: 'a.bin', display: 'a.bin' })
    expect(workingDiff).toHaveBeenLastCalledWith('/work/app', { path: 'a.bin' }, expect.anything())
    // A rename carries its origin so the comparison pairs the two paths.
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin&from=old.bin')).status).toBe(200)
    expect(workingDiff).toHaveBeenLastCalledWith('/work/app', { path: 'a.bin', from: 'old.bin' }, expect.anything())
    // A refused comparison is a 404, and the route lifetime ends with the plugin.
    workingDiff.mockResolvedValueOnce(undefined as never)
    expect((await call(diff, 'sessionId=s-1&cwd=%2Fwork%2Fapp&path=a.bin')).status).toBe(404)
    for (const off of disposers) off()
    expect(routes.size).toBe(0)
  })

  it('registers the working-tree git routes and removes them with the plugin', async () => {
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
    } as never)
    apply(ctx)
    expect(paths).toEqual(['/api/git.status', '/api/git.diff'])
    // Disposing the plugin aborts the lifetime its route reads share.
    await ctx.fiber.dispose()
    for (const off of disposers) off()
    expect(paths).toEqual([])
  })

})
