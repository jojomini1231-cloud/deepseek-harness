import { expect, it } from 'vitest'
import { hostBindArgs } from '../src/index.ts'

it('reads the bind pair from the trailing arguments, after the package-manager pair', () => {
  expect(hostBindArgs(['node', 'entry', '/runtime', '/project', '/primary', 'pnpm.mjs', '/bin', '--host', '127.0.0.1', '--port', '4123']))
    .toEqual(['--host', '127.0.0.1', '--port', '4123'])
})

it('is empty on a launch that appended nothing, with or without the package-manager pair', () => {
  expect(hostBindArgs(['node', 'entry', '/runtime', '/project', '/primary'])).toEqual([])
  expect(hostBindArgs(['node', 'entry', '/runtime', '/project', '/primary', 'pnpm.mjs', '/bin'])).toEqual([])
})

it('carries the publishing pair through with the bind pair', () => {
  expect(hostBindArgs(['node', 'entry', '/runtime', '/project', '/primary', 'pnpm.mjs', '/bin',
    '--host', '127.0.0.1', '--port', '4123', '--trusted-host', 'tunnel.example', '--public-url', 'https://tunnel.example/',
  ])).toEqual(['--host', '127.0.0.1', '--port', '4123',
    '--trusted-host', 'tunnel.example', '--public-url', 'https://tunnel.example/'])
})

it('never mistakes a package-manager path for a bind argument', () => {
  for (const argv of [
    ['node', 'entry', '/runtime', '/project', '/primary', 'pnpm.mjs', '/bin'],
    ['node', 'entry', '/runtime', '/project', '/primary'],
  ]) expect(hostBindArgs(argv).some(value => value.endsWith('pnpm.mjs'))).toBe(false)
})
