/** Working-tree git state and per-file comparisons against HEAD. */
import { existsSync } from 'node:fs'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FsPathInfo } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { GitRunner } from '../src/git.ts'
import { parsePorcelain, worktreeDiff, worktreeStatus } from '../src/worktree.ts'
import type { WorktreeLimits } from '../src/worktree.ts'
import { git, scratchDir } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const LIMITS: WorktreeLimits = { maxFiles: 500, maxFileBytes: 4096, outputMaxBytes: 1024 * 1024 }
const signal = new AbortController().signal

/** A filesystem whose lstat reports no size, as a backend that cannot size a path does. */
class SizelessFileSystem extends LocalFileSystem {
  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const info = await super.lstat(path, opts, signal)
    return info === undefined ? undefined : { version: info.version, type: info.type }
  }
}

interface Harness {
  readonly git: GitRunner
  /** The filesystem the comparison reads the after side through. */
  readonly fs: LocalFileSystem
}

async function harness(outputMaxBytes = 1024 * 1024, sizeless = false): Promise<Harness> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(sizeless ? SizelessFileSystem : LocalFileSystem, { cwd: process.cwd() })
  return {
    git: new GitRunner(ctx.subprocess, await ctx.subprocess.resolveExecutable('git'), {
      timeoutMs: 30_000, outputMaxBytes,
    }),
    fs: ctx.fs as LocalFileSystem,
  }
}

/** A repository with one committed file, a modified file, a staged file, an untracked file, and a deleted file. */
async function repository(): Promise<string> {
  const cwd = await scratchDir('dsh-worktree-', cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  await mkdir(join(cwd, 'src'))
  await writeFile(join(cwd, 'src', 'kept.ts'), 'keep\n')
  await writeFile(join(cwd, 'src', 'changed.ts'), 'before\n')
  await writeFile(join(cwd, 'src', 'gone.ts'), 'bye\n')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', 'seed')
  await writeFile(join(cwd, 'src', 'changed.ts'), 'after\n')
  await writeFile(join(cwd, 'src', 'staged.ts'), 'staged\n')
  git(cwd, 'add', 'src/staged.ts')
  await writeFile(join(cwd, 'src', 'untracked.ts'), 'new\n')
  await rm(join(cwd, 'src', 'gone.ts'))
  return cwd
}

describe('parsePorcelain', () => {
  it('splits branch and entries, and reads a rename origin as its own field', () => {
    const output = [
      '## main...origin/main',
      ' M src/changed.ts',
      'A  src/staged.ts',
      ' D src/gone.ts',
      '?? src/untracked.ts',
      'R  src/renamed.ts',
      'src/old.ts',
      '',
    ].join('\0')
    const parsed = parsePorcelain(output, '')
    expect(parsed.branch).toBe('main')
    expect(parsed.entries).toEqual([
      { path: 'src/changed.ts', display: 'src/changed.ts', kind: 'modified' },
      { path: 'src/gone.ts', display: 'src/gone.ts', kind: 'deleted' },
      { path: 'src/renamed.ts', display: 'src/renamed.ts', kind: 'renamed', from: 'src/old.ts' },
      { path: 'src/staged.ts', display: 'src/staged.ts', kind: 'added' },
      { path: 'src/untracked.ts', display: 'src/untracked.ts', kind: 'untracked' },
    ])
  })

  it('keeps the tracked record when git reports one path as deleted and untracked', () => {
    expect(parsePorcelain('D  src/f.ts\0?? src/f.ts\0', '').entries).toEqual([
      { path: 'src/f.ts', display: 'src/f.ts', kind: 'deleted' },
    ])
    // The untracked record arriving first is replaced by the tracked one.
    expect(parsePorcelain('?? src/g.ts\0D  src/g.ts\0', '').entries).toEqual([
      { path: 'src/g.ts', display: 'src/g.ts', kind: 'deleted' },
    ])
  })

  it('strips the working directory prefix from paths and rename origins', () => {
    const output = [
      ' M sub/a.ts',
      ' D other/b.ts',
      'R  sub/new.ts',
      'sub/old.ts',
      'R  sub/away.ts',
      'other/origin.ts',
      'R  sub/odd.ts',
      'sub/',
      '',
    ].join('\0')
    expect(parsePorcelain(output, 'sub/').entries).toEqual([
      { path: 'a.ts', display: 'a.ts', kind: 'modified' },
      { path: 'away.ts', display: 'away.ts', kind: 'renamed' },
      { path: 'new.ts', display: 'new.ts', kind: 'renamed', from: 'old.ts' },
      { path: 'odd.ts', display: 'odd.ts', kind: 'renamed' },
    ])
  })

  it('reads an unborn branch, a detached head, ignored records, and a truncated rename', () => {
    expect(parsePorcelain('## No commits yet on trunk\0', '').branch).toBe('trunk')
    expect(parsePorcelain('## HEAD (no branch)\0', '').branch).toBeUndefined()
    expect(parsePorcelain('!! build\0\0', '').entries).toEqual([])
    // A worktree-only rename carries the original path in the next field.
    expect(parsePorcelain(' R src/new.ts\0src/old.ts\0', '').entries).toEqual([
      { path: 'src/new.ts', display: 'src/new.ts', kind: 'renamed', from: 'src/old.ts' },
    ])
    // A record whose origin field is missing keeps its new path alone.
    expect(parsePorcelain('R  src/new.ts\0', '').entries).toEqual([
      { path: 'src/new.ts', display: 'src/new.ts', kind: 'renamed' },
    ])
    expect(parsePorcelain('R  src/new.ts', '').entries).toEqual([
      { path: 'src/new.ts', display: 'src/new.ts', kind: 'renamed' },
    ])
    // An unknown status letter still yields the entry rather than dropping it.
    expect(parsePorcelain('XY src/odd.ts\0', '').entries).toEqual([
      { path: 'src/odd.ts', display: 'src/odd.ts', kind: 'modified' },
    ])
  })
})

describe('worktreeStatus', () => {
  it('lists a repository working tree with its branch, entry cap, and complete count', async () => {
    const cwd = await repository()
    const { git: runner } = await harness()
    const status = await worktreeStatus(runner, cwd, signal, LIMITS)
    expect(status.kind).toBe('repository')
    expect(status.branch).toBe('main')
    expect(status.entries.map(entry => entry.path)).toEqual([
      'src/changed.ts', 'src/gone.ts', 'src/staged.ts', 'src/untracked.ts',
    ])
    expect(status.total).toBe(4)
    // The cap holds per group, so the untracked file survives beside the two
    // kept changes.
    const capped = await worktreeStatus(runner, cwd, signal, { ...LIMITS, maxFiles: 2 })
    expect(capped.entries.map(entry => entry.path))
      .toEqual(['src/changed.ts', 'src/gone.ts', 'src/untracked.ts'])
    expect(capped.total).toBe(4)
  })

  it('caps tracked changes and untracked files separately so neither group disappears', async () => {
    const cwd = await scratchDir('dsh-worktree-groups-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'src'))
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await writeFile(join(cwd, 'src', name), 'before\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await writeFile(join(cwd, 'src', name), 'after\n')
    // Untracked output sorts before the changed paths, so one shared budget
    // would spend every entry here and hide all tracked changes.
    await mkdir(join(cwd, 'dist'))
    for (let index = 0; index < 4; index += 1) await writeFile(join(cwd, 'dist', `o${index}.js`), 'out\n')
    const status = await worktreeStatus((await harness()).git, cwd, signal, { ...LIMITS, maxFiles: 2 })
    expect(status.entries).toEqual([
      { path: 'dist/o0.js', display: 'dist/o0.js', kind: 'untracked' },
      { path: 'dist/o1.js', display: 'dist/o1.js', kind: 'untracked' },
      { path: 'src/a.ts', display: 'src/a.ts', kind: 'modified' },
      { path: 'src/b.ts', display: 'src/b.ts', kind: 'modified' },
    ])
    expect(status.total).toBe(7)
  })

  it('reports paths relative to a nested working directory', async () => {
    const cwd = await scratchDir('dsh-worktree-nested-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'sub'))
    await writeFile(join(cwd, 'root.ts'), 'root\n')
    await writeFile(join(cwd, 'sub', 'inner.ts'), 'inner\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    await writeFile(join(cwd, 'root.ts'), 'root changed\n')
    await writeFile(join(cwd, 'sub', 'inner.ts'), 'inner changed\n')
    await writeFile(join(cwd, 'sub', 'new.ts'), 'new\n')
    const status = await worktreeStatus((await harness()).git, join(cwd, 'sub'), signal, LIMITS)
    expect(status.kind).toBe('repository')
    expect(status.entries).toEqual([
      { path: 'inner.ts', display: 'inner.ts', kind: 'modified' },
      { path: 'new.ts', display: 'new.ts', kind: 'untracked' },
    ])
    expect(status.total).toBe(2)
  })

  it('reports a detached head without a branch', async () => {
    const cwd = await repository()
    git(cwd, 'checkout', '-q', '--detach')
    const status = await worktreeStatus((await harness()).git, cwd, signal, LIMITS)
    expect(status.kind).toBe('repository')
    expect(status.branch).toBeUndefined()
  })

  it('reports a missing repository, a bare repository, and a directory inside .git', async () => {
    const plain = await scratchDir('dsh-worktree-plain-', cleanups)
    const { git: runner } = await harness()
    expect((await worktreeStatus(runner, plain, signal, LIMITS)).kind).toBe('not-a-repository')
    expect((await worktreeStatus(null, plain, signal, LIMITS)).kind).toBe('unavailable')

    const bare = await scratchDir('dsh-worktree-bare-', cleanups)
    git(bare, 'init', '-q', '--bare')
    expect((await worktreeStatus(runner, bare, signal, LIMITS)).kind).toBe('not-a-repository')

    const cwd = await repository()
    expect((await worktreeStatus(runner, join(cwd, '.git'), signal, LIMITS)).kind).toBe('not-a-repository')
  })

  it('reports an unreadable repository as unavailable', async () => {
    // An invalid `.git` file is not a non-repository answer: git cannot read the repository it names.
    const invalid = await scratchDir('dsh-worktree-gitfile-', cleanups)
    await writeFile(join(invalid, '.git'), 'garbage\n')
    expect((await worktreeStatus((await harness()).git, invalid, signal, LIMITS)).kind).toBe('unavailable')

    const cwd = await repository()
    await writeFile(join(cwd, '.git', 'index'), 'garbage')
    expect((await worktreeStatus((await harness()).git, cwd, signal, LIMITS)).kind).toBe('unavailable')
  })

  it('refuses a listing whose output was truncated', async () => {
    const cwd = await repository()
    const status = await worktreeStatus((await harness(40)).git, cwd, signal, LIMITS)
    expect(status).toEqual({ kind: 'unavailable', entries: [], total: 0 })
  })

  it('disables a repository-configured fsmonitor program', async () => {
    const calls: string[][] = []
    const runner = {
      run: async (args: string[]) => {
        calls.push(args)
        return args[0] === 'rev-parse'
          ? { exitCode: 0, stdout: 'true\n', stderr: '', truncated: false }
          : { exitCode: 0, stdout: '', stderr: '', truncated: false }
      },
    } as never
    expect((await worktreeStatus(runner, '/work/app', signal, LIMITS)).kind).toBe('repository')
    expect(calls[1]).toEqual([
      '-c', 'core.fsmonitor=false',
      'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all', '--', '.',
    ])
  })
})

describe('worktreeDiff', () => {
  it('compares a modified file with its HEAD text', async () => {
    const cwd = await repository()
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/changed.ts' }, signal, LIMITS)
    expect(diff).toMatchObject({
      kind: 'text', path: 'src/changed.ts', display: 'src/changed.ts', before: true, after: true, coarse: false,
    })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['-before', '+after'])
  })

  it('covers the whole file as context when the view asks for a complete comparison', async () => {
    const cwd = await scratchDir('dsh-worktree-complete-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    const lines = Array.from({ length: 20 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`)
    await writeFile(join(cwd, 'long.txt'), `${lines.join('\n')}\n`)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    await writeFile(join(cwd, 'long.txt'), `${[...lines.slice(0, 9), 'line-10 changed', ...lines.slice(10)].join('\n')}\n`)
    const { git: runner, fs } = await harness()
    const changed = await worktreeDiff(runner, fs, cwd, { path: 'long.txt' }, signal, LIMITS)
    expect(changed?.kind === 'text' ? changed.hunks.flatMap(hunk => hunk.lines) : []).toEqual([
      ' line-07', ' line-08', ' line-09', '-line-10', '+line-10 changed', ' line-11', ' line-12', ' line-13',
    ])
    // An explicit false asks for the same changed hunks as an absent flag.
    const explicit = await worktreeDiff(runner, fs, cwd, { path: 'long.txt', complete: false }, signal, LIMITS)
    expect(explicit).toEqual(changed)
    const whole = await worktreeDiff(runner, fs, cwd, { path: 'long.txt', complete: true }, signal, LIMITS)
    expect(whole?.kind === 'text' ? whole.hunks : []).toEqual([{
      oldStart: 1,
      oldLines: 20,
      newStart: 1,
      newLines: 20,
      lines: [
        ...lines.slice(0, 9).map(line => ` ${line}`),
        '-line-10',
        '+line-10 changed',
        ...lines.slice(10).map(line => ` ${line}`),
      ],
    }])
  })

  it('treats an untracked file as an addition and a deleted one as a removal', async () => {
    const cwd = await repository()
    const { git: runner, fs } = await harness()
    const added = await worktreeDiff(runner, fs, cwd, { path: 'src/untracked.ts' }, signal, LIMITS)
    expect(added).toMatchObject({ kind: 'text', before: false, after: true })
    expect(added?.kind === 'text' ? added.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['+new'])
    const removed = await worktreeDiff(runner, fs, cwd, { path: 'src/gone.ts' }, signal, LIMITS)
    expect(removed).toMatchObject({ kind: 'text', before: true, after: false })
  })

  it('compares a rename against the origin HEAD text', async () => {
    const cwd = await scratchDir('dsh-worktree-rename-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'old.ts'), 'one\ntwo\nthree\nfour\nfive\nsix\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    git(cwd, 'mv', 'src/old.ts', 'src/new.ts')
    await writeFile(join(cwd, 'src', 'new.ts'), 'one\nTWO\nthree\nfour\nfive\nsix\n')
    const { git: runner, fs } = await harness()
    const status = await worktreeStatus(runner, cwd, signal, LIMITS)
    expect(status.entries).toEqual([
      { path: 'src/new.ts', display: 'src/new.ts', kind: 'renamed', from: 'src/old.ts' },
    ])
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/new.ts', from: 'src/old.ts' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: true, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual([' one', '-two', '+TWO', ' three', ' four', ' five'])
  })

  it.skipIf(process.platform === 'win32')('compares a symbolic link by its text rather than its target', async () => {
    const cwd = await scratchDir('dsh-worktree-link-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'src'))
    await symlink('old-target', join(cwd, 'src', 'link'))
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    await rm(join(cwd, 'src', 'link'))
    await symlink('new-target', join(cwd, 'src', 'link'))
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/link' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: true, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual(['-old-target', '+new-target'])
  })

  it('answers an end-of-line conversion git already holds as no line changes', async () => {
    const cwd = await scratchDir('dsh-worktree-crlf-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, '.gitattributes'), '*.txt text eol=lf\n')
    await writeFile(join(cwd, 'src', 'line.txt'), 'line\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    await writeFile(join(cwd, 'src', 'line.txt'), 'line\r\n')
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/line.txt' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: true, after: true })
    expect(diff?.kind === 'text' ? diff.hunks : undefined).toEqual([])
  })

  it('reports binary sides without lines', async () => {
    const cwd = await scratchDir('dsh-worktree-binary-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src', 'tracked.bin'), Buffer.from([0, 1, 2]))
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    await writeFile(join(cwd, 'src', 'tracked.bin'), Buffer.from([0, 1, 3]))
    await writeFile(join(cwd, 'src', 'fresh.bin'), Buffer.from([0, 4, 5]))
    const { git: runner, fs } = await harness()
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/tracked.bin' }, signal, LIMITS)).toMatchObject({ kind: 'binary' })
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/fresh.bin' }, signal, LIMITS)).toMatchObject({ kind: 'binary' })
  })

  it('reports an empty untracked file without hunks', async () => {
    const cwd = await repository()
    await writeFile(join(cwd, 'src', 'empty.ts'), '')
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/empty.ts' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: false, after: true })
    expect(diff?.kind === 'text' ? diff.hunks : undefined).toEqual([])
  })

  it('compares an untracked file in a repository without commits against /dev/null', async () => {
    const cwd = await scratchDir('dsh-worktree-unborn-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'fresh.ts'), 'fresh\n')
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'fresh.ts' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: false, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['+fresh'])
  })

  it('reports oversized sides before reading a diff', async () => {
    const cwd = await repository()
    await writeFile(join(cwd, 'src', 'large.ts'), 'x'.repeat(64))
    const { git: runner, fs } = await harness()
    // The after side is the path the filesystem reports.
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/large.ts' }, signal, { ...LIMITS, maxFileBytes: 4 }))
      .toMatchObject({ kind: 'oversized' })
    // The before side is the HEAD blob, which can be larger than what the worktree holds now.
    git(cwd, 'add', 'src/large.ts')
    git(cwd, 'commit', '-q', '-m', 'large')
    await writeFile(join(cwd, 'src', 'large.ts'), 'y')
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/large.ts' }, signal, { ...LIMITS, maxFileBytes: 4 }))
      .toMatchObject({ kind: 'oversized' })
  })

  it('reports a comparison whose output was truncated as oversized', async () => {
    const cwd = await repository()
    const { git: runner, fs } = await harness()
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/changed.ts' }, signal,
      { ...LIMITS, outputMaxBytes: 20 })
    expect(diff).toMatchObject({ kind: 'oversized' })
  })

  it('keeps the size cap with the provider when lstat reports no size', async () => {
    const cwd = await repository()
    await writeFile(join(cwd, 'src', 'unsized.ts'), 'unsized\n')
    const { git: runner, fs } = await harness(1024 * 1024, true)
    const diff = await worktreeDiff(runner, fs, cwd, { path: 'src/unsized.ts' }, signal, { ...LIMITS, maxFileBytes: 4 })
    expect(diff).toMatchObject({ kind: 'text', before: false, after: true })
  })

  it('answers a directory and a path git does not know as no comparison', async () => {
    const cwd = await repository()
    const { git: runner, fs } = await harness()
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src' }, signal, LIMITS))
      .toEqual({ kind: 'text', path: 'src', display: 'src', before: false, after: false, hunks: [], coarse: false })
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/nope.ts' }, signal, LIMITS))
      .toEqual({
        kind: 'text', path: 'src/nope.ts', display: 'src/nope.ts', before: false, after: false, hunks: [], coarse: false,
      })
  })

  it('refuses a path or rename origin outside the working directory', async () => {
    const cwd = await repository()
    const { git: runner, fs } = await harness()
    expect(await worktreeDiff(runner, fs, cwd, { path: '../escape.ts' }, signal, LIMITS)).toBeUndefined()
    expect(await worktreeDiff(runner, fs, cwd, { path: 'src/changed.ts', from: '../escape.ts' }, signal, LIMITS))
      .toBeUndefined()
  })

  it('fails when git cannot compare a tracked path', async () => {
    const cwd = await repository()
    await writeFile(join(cwd, '.git', 'index'), 'garbage')
    const { git: runner, fs } = await harness()
    await expect(worktreeDiff(runner, fs, cwd, { path: 'src/changed.ts' }, signal, LIMITS))
      .rejects.toThrow(/git diff in .* failed/u)
  })

  it.skipIf(process.platform === 'win32')('refuses a path reached through a directory link outside the working directory', async () => {
    const cwd = await repository()
    const outside = await scratchDir('dsh-worktree-outside-', cleanups)
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(outside, join(cwd, 'out-link'))
    const { git: runner, fs } = await harness()
    expect(await worktreeDiff(runner, fs, cwd, { path: 'out-link/secret.txt' }, signal, LIMITS)).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('fails a comparison git cannot write, as for a link to a directory', async () => {
    const cwd = await repository()
    await symlink('src', join(cwd, 'src-link'))
    const { git: runner, fs } = await harness()
    await expect(worktreeDiff(runner, fs, cwd, { path: 'src-link' }, signal, LIMITS))
      .rejects.toThrow(/git diff --no-index/u)
  })

  it.skipIf(process.platform === 'win32')('does not run a repository-configured textconv driver', async () => {
    const cwd = await scratchDir('dsh-worktree-textconv-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, '.gitattributes'), '*.txt diff=mine\n')
    await writeFile(join(cwd, 'a.txt'), 'one\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    const marker = join(cwd, 'textconv-ran')
    git(cwd, 'config', 'diff.mine.textconv', `sh -c 'touch ${marker}; cat "$1"' --`)
    await writeFile(join(cwd, 'a.txt'), 'two\n')
    const { git: runner, fs } = await harness()
    expect(await worktreeDiff(runner, fs, cwd, { path: 'a.txt' }, signal, LIMITS)).toMatchObject({ kind: 'text' })
    expect(existsSync(marker)).toBe(false)
  })
})
