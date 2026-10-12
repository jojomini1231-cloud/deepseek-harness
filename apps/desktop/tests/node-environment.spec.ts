import { delimiter } from 'node:path'
import { expect, it } from 'vitest'
import { resolveDesktopHostRuntime } from '../src/host-runtime.ts'
import { desktopNodeEnvironment } from '../src/node-environment.ts'

const electronHost = { executable: '/desktop/electron', electron: true }
const bundledHost = { executable: '/bundled/node', electron: false }

it('keeps private Desktop launchers out of the Host environment inherited by PTC', () => {
  const environment = { PATH: '/user/bin', HOME: '/user' }
  expect(desktopNodeEnvironment(electronHost, undefined, environment)).toEqual({
    ...environment, ELECTRON_RUN_AS_NODE: '1',
  })
  expect(environment).toEqual({ PATH: '/user/bin', HOME: '/user' })
})

it('marks Electron Node mode only for an Electron Host', () => {
  const host = resolveDesktopHostRuntime('linux', '/desktop/electron', '/bundled/node')
  expect(host).toEqual(bundledHost)
  expect(desktopNodeEnvironment(host, undefined, { PATH: '/user/bin' })).toEqual({ PATH: '/user/bin' })
  expect(resolveDesktopHostRuntime('darwin', '/desktop/electron', '/bundled/node')).toEqual(electronHost)
})

it('provides private launchers only to package installation processes', () => {
  expect(desktopNodeEnvironment(electronHost, '/desktop/bin', { PATH: '/user/bin' })).toEqual({
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP_NODE_EXECUTABLE: '/desktop/electron',
    PATH: `/desktop/bin${delimiter}/user/bin`,
  })
  expect(desktopNodeEnvironment(bundledHost, '/desktop/bin', { PATH: '/user/bin' })).toEqual({
    DSH_DESKTOP_NODE_EXECUTABLE: '/bundled/node',
    PATH: `/desktop/bin${delimiter}/user/bin`,
  })
})
