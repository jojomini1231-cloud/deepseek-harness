/**
 * The browser-device registry: where Connection records a launch-token exchange,
 * consults the attached registry on every authenticated request, and reports
 * activity only for admitted API requests.
 */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebUpgradeRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject } from '../src/index.ts'
import { BrowserAuth } from '../src/browser-auth.ts'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  HostConnectionHandle,
} from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'
import { RecordBrowserDevices } from './browser-devices.ts'
import { fakeHttpServer } from './fake-http-server.ts'

/** Minimal index request carrying a Host and optional Cookie. */
function request(url: string, authority = '127.0.0.1:3080', cookie?: string): ConnectionIndexRequest {
  return {
    method: 'GET',
    url,
    headers: { host: authority, ...cookie === undefined ? {} : { cookie } },
  }
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end(body) { if (body !== undefined) state.body = body },
    },
    state,
  }
}

/**
 * Exchange a process token for one minted Set-Cookie header. A repeat exchange
 * presents the cookie the browser already holds, exactly as a browser that
 * re-opens the printed URL does.
 * @param auth - authentication owner to exchange against.
 * @param existing - Cookie header the browser already holds, when it holds one.
 * @param authority - deployment authority the browser reaches.
 * @returns the complete Set-Cookie header the exchange answered with.
 */
function exchange(auth: BrowserAuth, existing?: string, authority = '127.0.0.1:3080'): string {
  const url = new URL(auth.authenticatedUrl(`http://${authority}`))
  const res = response()
  expect(auth.authorizeIndex(
    request(`${url.pathname}${url.search}`, authority, existing), res.value,
  )).toBe(false)
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('token exchange did not set a cookie')
  return setCookie
}

function cookieHeader(setCookie: string): string {
  return setCookie.split(';', 1)[0]!
}

/** Decode the minted cookie's signed payload for the assertions that read it. */
function payloadOf(setCookie: string): { device?: unknown } {
  const [name, value] = cookieHeader(setCookie).split('=') as [string, string]
  const body = value.slice(value.indexOf('.') + 1, value.lastIndexOf('.'))
  expect(name).toMatch(/^dsh-auth-/u)
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { device?: unknown }
}

function createAuth(store: RecordCredentials, maxAgeDays = 30): Promise<BrowserAuth> {
  return BrowserAuth.create({}, store as never, maxAgeDays)
}

afterEach(() => { vi.useRealTimers() })

describe('browser device registry seam', () => {
  it('records one exchange and binds the minted cookie to the returned device', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    auth.attachBrowserDevices(devices)

    const setCookie = exchange(auth)
    expect(devices.opened).toHaveLength(1)
    expect(devices.opened[0]!.session).toEqual({ userAgent: '' })
    expect(payloadOf(setCookie).device).toBe(devices.opened[0]!.id)
  })

  it('supplies the peer address and user agent the exchange observed', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    auth.attachBrowserDevices(devices)

    const url = new URL(auth.authenticatedUrl('http://127.0.0.1:3080'))
    const res = response()
    auth.authorizeIndex({
      method: 'GET',
      url: `${url.pathname}${url.search}`,
      headers: { host: '127.0.0.1:3080', 'user-agent': 'TestAgent/1' },
      socket: { remoteAddress: '10.0.0.7' },
    }, res.value)
    expect(devices.opened[0]!.session).toEqual({ userAgent: 'TestAgent/1', address: '10.0.0.7' })
  })

  it('reuses the device a repeat exchange already holds', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    auth.attachBrowserDevices(devices)

    const first = exchange(auth)
    const second = exchange(auth, cookieHeader(first))
    expect(devices.minted).toHaveLength(1)
    expect(devices.opened[1]!.session.previous).toBe(devices.opened[0]!.id)
    // The repeat exchange re-mints the same binding rather than a second row.
    expect(payloadOf(second).device).toBe(devices.opened[0]!.id)
    expect(payloadOf(second).device).toBe(payloadOf(first).device)
  })

  it('refuses a revoked device on every authenticated path while the SPA never loads', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    auth.attachBrowserDevices(devices)
    const cookie = cookieHeader(exchange(auth))
    const device = devices.opened[0]!.id
    devices.revoked.add(device)

    expect(auth.session(request('/', '127.0.0.1:3080', cookie))).toBeUndefined()
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', cookie))).toBe(false)

    const denied = response()
    expect(auth.authorizeIndex(request('/index.html', '127.0.0.1:3080', cookie), denied.value)).toBe(false)
    expect(denied.state.status).toBe(401)

    // A revoked browser re-opens the printed URL and enrolls as a new device.
    // Connection still supplies the fact; the registry owns the reuse policy,
    // and this double reuses whatever the verified cookie named.
    const reenrolled = exchange(auth, cookie)
    expect(devices.opened[1]!.session.previous).toBe(device)
    expect(payloadOf(reenrolled).device).toBe(device)
  })

  it('keeps a cookie minted before device tracking authenticating, and never consults the registry for it', async () => {
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    // Minted while no registry was attached: the payload carries no device.
    const legacy = cookieHeader(exchange(auth))
    expect(payloadOf(legacy).device).toBeUndefined()

    const devices = new RecordBrowserDevices()
    auth.attachBrowserDevices(devices)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', legacy))).toBe(true)
    // Revoking every known id cannot reach a session that has no row.
    expect(devices.admitted).toEqual([])
  })

  it('refuses a signed payload whose device id is malformed rather than downgrading it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    auth.attachBrowserDevices(new RecordBrowserDevices())
    const [name] = cookieHeader(exchange(auth)).split('=') as [string]

    for (const device of [42, '', null, { id: 'x' }]) {
      const payload = {
        version: 1, authority: '127.0.0.1:3080',
        issuedAt: Date.now(), expiresAt: Date.now() + 1000, device,
      }
      const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
      const record = store.record
      if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
        throw new Error('test credential store has no signing secret')
      }
      const secret = Reflect.get(record.payload, 'secret') as string
      const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', `${name}=v1.${body}.${signature}`))).toBe(false)
    }
  })

  it('reports activity only for an admitted request, never for the index request', async () => {
    const { connection, dispose } = await mounted()
    try {
      const devices = new RecordBrowserDevices()
      const detach = await attachment(connection, devices)
      const cookie = cookieHeader(exchangeService(connection))

      const served = response()
      expect(connection.authorizeIndex(
        request('/index.html', '127.0.0.1:3080', cookie), served.value,
      )).toBe(true)
      expect(devices.touched).toEqual([])
      // Serving the shell still consults revocation.
      expect(devices.admitted).toHaveLength(1)

      expect(connection.admit(request('/', '127.0.0.1:3080', cookie))).toEqual({ peer: connection.operator })
      expect(devices.touched).toHaveLength(1)
      await detach()
    } finally {
      await dispose()
    }
  })

  it('refuses every authenticated entry point once the device is revoked', async () => {
    const { connection, dispose } = await mounted()
    try {
      const devices = new RecordBrowserDevices()
      const detach = await attachment(connection, devices)
      const cookie = cookieHeader(exchangeService(connection))
      devices.revoked.add(devices.opened[0]!.id)

      expect(connection.requestRejection(request('/', '127.0.0.1:3080', cookie))).toBe(401)
      expect(connection.admit(request('/', '127.0.0.1:3080', cookie))).toEqual({ rejection: 401 })
      await detach()
    } finally {
      await dispose()
    }
  })

  it('contains a registry failure while reporting activity and keeps the admission', async () => {
    const { ctx, connection, dispose } = await mounted()
    try {
      const devices = new RecordBrowserDevices()
      const detach = await attachment(connection, devices)
      const cookie = cookieHeader(exchangeService(connection))
      devices.failTouch = new Error('registry unavailable')
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

      expect(connection.admit(request('/', '127.0.0.1:3080', cookie))).toEqual({ peer: connection.operator })
      expect(warn).toHaveBeenCalledOnce()
      // A registry that throws something other than an Error is reported too.
      devices.failTouch = 'registry unavailable'
      expect(connection.admit(request('/', '127.0.0.1:3080', cookie))).toEqual({ peer: connection.operator })
      expect(warn).toHaveBeenCalledTimes(2)
      warn.mockRestore()
      await detach()
    } finally {
      await dispose()
    }
  })

  it('mints nothing and propagates when the registry refuses the exchange', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    devices.failOpen = new Error('registry unavailable')
    auth.attachBrowserDevices(devices)

    const url = new URL(auth.authenticatedUrl('http://127.0.0.1:3080'))
    const res = response()
    expect(() => auth.authorizeIndex(request(`${url.pathname}${url.search}`), res.value))
      .toThrow('registry unavailable')
    // No cookie, no redirect: the exchange produced nothing.
    expect(res.state).toEqual({})
  })

  it('refuses a second attachment and restores today behavior when the first detaches', async () => {
    const auth = await createAuth(new RecordCredentials())
    const devices = new RecordBrowserDevices()
    const detach = auth.attachBrowserDevices(devices)
    expect(() => auth.attachBrowserDevices(new RecordBrowserDevices()))
      .toThrow('a browser-device store is already attached')

    const cookie = cookieHeader(exchange(auth))
    detach()
    // The cookie keeps authenticating; only reporting stops.
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', cookie))).toBe(true)
    expect(() => { auth.touchDevice(devices.opened[0]!.id) }).not.toThrow()
    expect(devices.touched).toEqual([])
    // A fresh exchange with no registry encodes no device at all.
    expect(payloadOf(exchange(auth)).device).toBeUndefined()
    expect(() => auth.attachBrowserDevices(devices)).not.toThrow()
  })

  it('leaves the minted cookie byte-identical while no registry is attached', async () => {
    const store = new RecordCredentials()
    const bare = await createAuth(store)
    const attached = await createAuth(store)
    attached.attachBrowserDevices(new RecordBrowserDevices())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))

    const withoutStore = cookieHeader(exchange(bare))
    const withStore = cookieHeader(exchange(attached))
    // Same name, same issue/expiry interval; only the device field is added.
    expect(withoutStore.split('=')[0]).toBe(withStore.split('=')[0])
    expect(JSON.parse(Buffer.from(
      withoutStore.split('.')[1]!, 'base64url',
    ).toString('utf8'))).toEqual({
      version: 1, authority: '127.0.0.1:3080',
      issuedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  })
})

/** Mount Connection over a fake Web carrier, as node-half.host.spec.ts does. */
async function mounted(): Promise<{
  ctx: Context
  connection: HostConnectionHandle
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  ctx.provide('credentials', new RecordCredentials() as never)
  ctx.provide('webServer', fakeHttpServer(routes, upgrades, '127.0.0.1', 'http:') as WebServer)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, connection: ctx.get('connection') as HostConnectionHandle, dispose: () => fiber.dispose() }
}

/** Attach a registry the way a Host controller does, on the caller's fiber. */
async function attachment(
  connection: HostConnectionHandle,
  store: RecordBrowserDevices,
): Promise<() => Promise<void>> {
  return connection.attachBrowserDevices(store)
}

/** Exchange the mounted service's process token for one Cookie header. */
function exchangeService(connection: HostConnectionHandle, authority = '127.0.0.1:3080'): string {
  const url = new URL(connection.authenticatedUrl(`http://${authority}`))
  const exchanged = response()
  connection.authorizeIndex(request(`${url.pathname}${url.search}`, authority), exchanged.value)
  const setCookie = exchanged.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('service token exchange did not set a cookie')
  return setCookie
}
