import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePackagingTempDirectory, temporaryDirectoryFailure } from '../scripts/packaging-temp-directory.mjs'

describe('packaging temporary directory probe', () => {
  it('accepts a directory that lists, returns, and does not keep a probe file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-temp-usable-'))
    try {
      expect(temporaryDirectoryFailure(root)).toBeUndefined()
      expect(await readdir(root)).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects a path that cannot hold a probe file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-temp-blocked-'))
    try {
      const blocker = join(root, 'blocker')
      await writeFile(blocker, 'not a directory\n')
      const failure = temporaryDirectoryFailure(join(blocker, 'temp'))
      expect(failure).toContain(join(blocker, 'temp'))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('packaging temporary directory selection', () => {
  it('uses the first usable candidate and reports the rejected ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-temp-fallback-'))
    try {
      const blocker = join(root, 'blocker')
      await writeFile(blocker, 'not a directory\n')
      const usable = join(root, 'usable')
      const resolved = resolvePackagingTempDirectory([
        { label: 'TEMP', directory: join(blocker, 'temp') },
        { label: 'fallback', directory: usable },
      ])
      expect(resolved.directory).toBe(usable)
      expect(resolved.failures).toHaveLength(1)
      expect(resolved.failures[0]).toContain('TEMP')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('skips candidates the environment does not set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-temp-unset-'))
    try {
      const resolved = resolvePackagingTempDirectory([
        { label: 'TEMP', directory: undefined },
        { label: 'TMP', directory: '' },
        { label: 'fallback', directory: root },
      ])
      expect(resolved.directory).toBe(root)
      expect(resolved.failures).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails naming every candidate when none is usable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-temp-unusable-'))
    try {
      const blocker = join(root, 'blocker')
      await writeFile(blocker, 'not a directory\n')
      expect(() => resolvePackagingTempDirectory([
        { label: 'TEMP', directory: join(blocker, 'temp') },
        { label: 'TMP', directory: join(blocker, 'other') },
      ])).toThrow(/no temporary directory is usable[\s\S]*TEMP[\s\S]*TMP/u)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
