/** Repository history reads: refs, history pages, commit detail, and commit-file comparisons. */
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { GitRunner } from '../src/git.ts'
import type { GitRunResult } from '../src/git.ts'
import { commit, commitDiff, history, historyRefs } from '../src/history.ts'
import type { HistoryLimits } from '../src/history.ts'
import { git, scratchDir } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const LIMITS: HistoryLimits = { maxCommits: 100, maxFiles: 500, maxFileBytes: 1024, outputMaxBytes: 1024 * 1024 }
const signal = new AbortController().signal

/** A git runner over the local subprocess runtime, with its own stdout cap. */
async function harness(outputMaxBytes = 1024 * 1024): Promise<GitRunner> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime)
  return new GitRunner(ctx.subprocess, await ctx.subprocess.resolveExecutable('git'), { timeoutMs: 30_000, outputMaxBytes })
}

/** Stage every change and commit it. */
function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
}

/** The commit `HEAD` names. */
function headHash(cwd: string): string {
  return git(cwd, 'rev-parse', 'HEAD').trim()
}

/** A repository with one commit, a second branch, a lightweight and an annotated tag, and a remote-tracking branch. */
async function refRepository(): Promise<string> {
  const cwd = await scratchDir('dsh-history-refs-', cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  await writeFile(join(cwd, 'a.txt'), 'one\n')
  commitAll(cwd, 'one')
  git(cwd, 'branch', 'other')
  git(cwd, 'tag', 'light')
  git(cwd, 'tag', '-a', 'v1', '-m', 'release one')
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  git(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  return cwd
}

/** Five linear commits on `main`. */
async function linearRepository(): Promise<string> {
  const cwd = await scratchDir('dsh-history-log-', cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  for (const index of [1, 2, 3, 4, 5]) {
    await writeFile(join(cwd, `${index}.txt`), `${index}\n`)
    commitAll(cwd, `commit ${index}`)
  }
  return cwd
}

/** A root commit, one ordinary commit, and a merge whose first-parent diff holds only the side branch's file. */
interface Commits {
  readonly cwd: string
  readonly root: string
  readonly second: string
  readonly merge: string
}

async function commitRepository(): Promise<Commits> {
  const cwd = await scratchDir('dsh-history-commit-', cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  await mkdir(join(cwd, 'sub'))
  await mkdir(join(cwd, 'other'))
  await writeFile(join(cwd, 'sub', 'a.txt'), 'one\ntwo\nthree\n')
  await writeFile(join(cwd, 'sub', 'old.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n')
  await writeFile(join(cwd, 'sub', 'gone.txt'), 'bye\n')
  await writeFile(join(cwd, 'sub', 'bin.dat'), Uint8Array.of(0, 1, 2))
  await writeFile(join(cwd, 'other', 'move.txt'), 'moved\n')
  await writeFile(join(cwd, 'other', 'outside.txt'), 'outside\n')
  await writeFile(join(cwd, 'top.txt'), 'top\n')
  commitAll(cwd, 'root commit\n\nroot body')
  const root = headHash(cwd)

  await writeFile(join(cwd, 'sub', 'a.txt'), 'one\nTWO\nthree\nfour\n')
  git(cwd, 'mv', 'sub/old.txt', 'sub/renamed.txt')
  await writeFile(join(cwd, 'sub', 'renamed.txt'), 'one\ntwo\nthree\nFOUR\nfive\nsix\n')
  git(cwd, 'mv', 'other/move.txt', 'sub/moved.txt')
  await rm(join(cwd, 'sub', 'gone.txt'))
  await writeFile(join(cwd, 'sub', 'new.txt'), 'new\n')
  await writeFile(join(cwd, 'sub', 'bin.dat'), Uint8Array.of(0, 1, 3))
  await writeFile(join(cwd, 'other', 'outside.txt'), 'outside changed\n')
  commitAll(cwd, 'second')
  const second = headHash(cwd)

  git(cwd, 'checkout', '-q', '-b', 'side')
  await writeFile(join(cwd, 'side.txt'), 'side\n')
  commitAll(cwd, 'side')
  git(cwd, 'checkout', '-q', 'main')
  git(cwd, 'merge', '-q', '--no-ff', 'side', '-m', 'merge side')
  return { cwd, root, second, merge: headHash(cwd) }
}

describe('historyRefs', () => {
  it('lists local branches, remote branches, and tags in git order with the current branch marked', async () => {
    const cwd = await refRepository()
    const hash = headHash(cwd)
    const refs = await historyRefs(await harness(), cwd, signal)
    expect(refs).toEqual([
      { name: 'main', refname: 'refs/heads/main', kind: 'local', hash, head: true },
      { name: 'other', refname: 'refs/heads/other', kind: 'local', hash },
      { name: 'origin/main', refname: 'refs/remotes/origin/main', kind: 'remote', hash },
      { name: 'light', refname: 'refs/tags/light', kind: 'tag', hash },
      { name: 'v1', refname: 'refs/tags/v1', kind: 'tag', hash },
    ])
    // The annotated tag's own object is not the commit it names.
    expect(git(cwd, 'rev-parse', 'v1').trim()).not.toBe(hash)
  })

  it('moves the head mark with the checked-out branch and drops it on a detached head', async () => {
    const cwd = await refRepository()
    git(cwd, 'checkout', '-q', 'other')
    expect((await historyRefs(await harness(), cwd, signal)).filter(ref => ref.head === true).map(ref => ref.name))
      .toEqual(['other'])
    git(cwd, 'checkout', '-q', '--detach')
    expect((await historyRefs(await harness(), cwd, signal)).filter(ref => ref.head === true)).toEqual([])
  })

  it('answers an empty list for a repository without refs', async () => {
    const cwd = await scratchDir('dsh-history-empty-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    expect(await historyRefs(await harness(), cwd, signal)).toEqual([])
  })

  it('leaves out a tag whose target is not a commit', async () => {
    const cwd = await refRepository()
    git(cwd, 'tag', 'tree-tag', 'HEAD^{tree}')
    const names = (await historyRefs(await harness(), cwd, signal)).map(ref => ref.name)
    // Walking such a tag would list no commits, which reads as an empty repository.
    expect(names).not.toContain('tree-tag')
  })

  it('rejects a truncated listing and a directory outside a repository', async () => {
    const cwd = await refRepository()
    await expect(historyRefs(await harness(16), cwd, signal)).rejects.toThrow(/for-each-ref.*exceeded/u)
    const plain = await scratchDir('dsh-history-plain-', cleanups)
    await expect(historyRefs(await harness(), plain, signal)).rejects.toThrow(/for-each-ref/u)
  })
})

describe('history', () => {
  it('pages a ref in topological order newest first with the requested size', async () => {
    const cwd = await linearRepository()
    const runner = await harness()
    const commits = [5, 4, 3, 2, 1].map(index => git(cwd, 'log', '--format=%H', `--grep=commit ${index}$`).trim())
    const first = await history(runner, cwd, { skip: 0, limit: 2 }, signal, LIMITS)
    expect(first.commits.map(entry => entry.subject)).toEqual(['commit 5', 'commit 4'])
    expect(first.commits.map(entry => entry.hash)).toEqual(commits.slice(0, 2))
    expect(first.hasMore).toBe(true)
    expect(first.commits[0]).toMatchObject({
      short: commits[0]!.slice(0, first.commits[0]!.short.length),
      parents: [commits[1]],
      author: 't',
      subject: 'commit 5',
    })
    expect(Number.isNaN(Date.parse(first.commits[0]!.authoredAt))).toBe(false)
    const second = await history(runner, cwd, { skip: 2, limit: 2 }, signal, LIMITS)
    expect(second.commits.map(entry => entry.subject)).toEqual(['commit 3', 'commit 2'])
    expect(second.hasMore).toBe(true)
    const last = await history(runner, cwd, { skip: 4, limit: 2 }, signal, LIMITS)
    expect(last.commits.map(entry => entry.subject)).toEqual(['commit 1'])
    expect(last.hasMore).toBe(false)
    expect(last.commits[0]!.parents).toEqual([])
    expect(await history(runner, cwd, { skip: 10, limit: 2 }, signal, LIMITS)).toEqual({ commits: [], hasMore: false })
  })

  it('walks only a full ref of a listed namespace that resolves to a commit', async () => {
    const cwd = await linearRepository()
    const runner = await harness()
    const third = git(cwd, 'rev-parse', 'HEAD~2').trim()
    const fourth = git(cwd, 'rev-parse', 'HEAD~1').trim()
    git(cwd, 'tag', 'v1', third)
    git(cwd, 'update-ref', 'refs/remotes/origin/main', fourth)
    expect((await history(runner, cwd, { ref: 'refs/tags/v1', skip: 0, limit: 1 }, signal, LIMITS)).commits[0]!.hash)
      .toBe(third)
    expect((await history(runner, cwd, { ref: 'refs/remotes/origin/main', skip: 0, limit: 1 }, signal, LIMITS))
      .commits[0]!.hash).toBe(fourth)
    await expect(history(runner, cwd, { ref: 'refs/heads/nope', skip: 0, limit: 1 }, signal, LIMITS))
      .rejects.toThrow(/not one of the repository's refs/u)
    // A tag that names a tree holds no commits to walk.
    git(cwd, 'tag', 'tree-tag', 'HEAD^{tree}')
    await expect(history(runner, cwd, { ref: 'refs/tags/tree-tag', skip: 0, limit: 1 }, signal, LIMITS))
      .rejects.toThrow(/not one of the repository's refs/u)
    // A name outside the three listed namespaces is not a walk coordinate.
    await expect(history(runner, cwd, { ref: 'HEAD', skip: 0, limit: 1 }, signal, LIMITS))
      .rejects.toThrow(/not one of the repository's refs/u)
    // An option-like name is refused before git could read it as one.
    await expect(history(runner, cwd, { ref: '-h', skip: 0, limit: 1 }, signal, LIMITS))
      .rejects.toThrow(/not one of the repository's refs/u)
  })

  it('clamps the page size to the configured commit cap', async () => {
    const cwd = await linearRepository()
    const page = await history(await harness(), cwd, { skip: 0, limit: 4 }, signal, { ...LIMITS, maxCommits: 2 })
    expect(page.commits.map(entry => entry.subject)).toEqual(['commit 5', 'commit 4'])
    expect(page.hasMore).toBe(true)
  })

  it('reports a merge commit’s parents in order', async () => {
    const cwd = await scratchDir('dsh-history-merge-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'root.txt'), 'root\n')
    commitAll(cwd, 'root')
    const root = headHash(cwd)
    await writeFile(join(cwd, 'base.txt'), 'base\n')
    commitAll(cwd, 'base')
    const main = headHash(cwd)
    git(cwd, 'checkout', '-q', '-b', 'side')
    await writeFile(join(cwd, 'side.txt'), 'side\n')
    commitAll(cwd, 'side')
    const side = headHash(cwd)
    git(cwd, 'checkout', '-q', 'main')
    git(cwd, 'merge', '-q', '--no-ff', 'side', '-m', 'merge side')
    const merge = headHash(cwd)
    const page = await history(await harness(), cwd, { skip: 0, limit: 5 }, signal, LIMITS)
    expect(page.commits[0]).toMatchObject({ hash: merge, parents: [main, side], subject: 'merge side' })
    expect(page.commits.at(-1)!.hash).toBe(root)
    // Topological order never lists a parent before its child.
    const at = new Map(page.commits.map((entry, index) => [entry.hash, index]))
    for (const entry of page.commits) {
      for (const parent of entry.parents) expect(at.get(parent)!).toBeGreaterThan(at.get(entry.hash)!)
    }
  })

  it('answers an empty page for a repository without commits', async () => {
    const cwd = await scratchDir('dsh-history-unborn-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    expect(await history(await harness(), cwd, { skip: 0, limit: 10 }, signal, LIMITS))
      .toEqual({ commits: [], hasMore: false })
  })

  it('rejects non-integer and out-of-range coordinates', async () => {
    const cwd = await linearRepository()
    const runner = await harness()
    await expect(history(runner, cwd, { skip: -1, limit: 1 }, signal, LIMITS)).rejects.toThrow(/skip/u)
    await expect(history(runner, cwd, { skip: 0.5, limit: 1 }, signal, LIMITS)).rejects.toThrow(/skip/u)
    await expect(history(runner, cwd, { skip: 0, limit: 0 }, signal, LIMITS)).rejects.toThrow(/limit/u)
    await expect(history(runner, cwd, { skip: 0, limit: 1.5 }, signal, LIMITS)).rejects.toThrow(/limit/u)
  })

  it('rejects a truncated log', async () => {
    const cwd = await linearRepository()
    await expect(history(await harness(80), cwd, { skip: 0, limit: 5 }, signal, LIMITS)).rejects.toThrow(/git log.*exceeded/u)
  })
})

describe('commit', () => {
  it('reads a root commit’s message and every file it added', async () => {
    const { cwd, root } = await commitRepository()
    const detail = await commit(await harness(), cwd, root, signal, LIMITS)
    expect(detail).toBeDefined()
    expect(detail!.commit).toMatchObject({ hash: root, parents: [], author: 't', subject: 'root commit' })
    expect(root.startsWith(detail!.commit.short)).toBe(true)
    expect(detail!.message).toBe('root commit\n\nroot body')
    expect(detail!.total).toBe(7)
    expect(detail!.files.map(file => file.path)).toEqual([
      'other/move.txt', 'other/outside.txt', 'sub/a.txt', 'sub/bin.dat', 'sub/gone.txt', 'sub/old.txt', 'top.txt',
    ])
    expect(detail!.files.every(file => file.kind === 'added')).toBe(true)
    expect(detail!.files.find(file => file.path === 'sub/a.txt')).toMatchObject({ added: 3, deleted: 0 })
    expect(detail!.files.find(file => file.path === 'sub/bin.dat')).toMatchObject({
      binary: true, added: 0, deleted: 0,
    })
  })

  it('maps a commit’s additions, modifications, deletions, renames, and binary files', async () => {
    const { cwd, root, second } = await commitRepository()
    const detail = await commit(await harness(), cwd, second, signal, LIMITS)
    expect(detail!.commit.parents).toEqual([root])
    const byPath = new Map(detail!.files.map(file => [file.path, file]))
    expect(byPath.get('sub/a.txt')).toMatchObject({ kind: 'modified', added: 2, deleted: 1 })
    expect(byPath.get('sub/new.txt')).toMatchObject({ kind: 'added', added: 1, deleted: 0 })
    expect(byPath.get('sub/gone.txt')).toMatchObject({ kind: 'deleted', added: 0, deleted: 1 })
    expect(byPath.get('sub/renamed.txt')).toMatchObject({
      kind: 'renamed', from: 'sub/old.txt', added: 1, deleted: 1,
    })
    expect(byPath.get('other/outside.txt')).toMatchObject({ kind: 'modified', added: 1, deleted: 1 })
    expect(byPath.get('sub/bin.dat')).toMatchObject({ kind: 'modified', binary: true, added: 0, deleted: 0 })
    expect(byPath.get('sub/moved.txt')).toMatchObject({ kind: 'renamed', from: 'other/move.txt', added: 0, deleted: 0 })
    expect(detail!.total).toBe(7)
  })

  it('uses a merge commit’s first parent for its file list', async () => {
    const { cwd, second, merge } = await commitRepository()
    const detail = await commit(await harness(), cwd, merge, signal, LIMITS)
    expect(detail!.commit.parents).toEqual([second, git(cwd, 'rev-parse', 'side').trim()])
    expect(detail!.files).toEqual([{ path: 'side.txt', display: 'side.txt', kind: 'added', added: 1, deleted: 0 }])
    expect(detail!.total).toBe(1)
  })

  it('keeps the working directory prefix and drops paths outside it', async () => {
    const { cwd, root, second } = await commitRepository()
    const runner = await harness()
    const nested = join(cwd, 'sub')
    const detail = await commit(runner, nested, root, signal, LIMITS)
    expect(detail!.files.map(file => file.path)).toEqual(['a.txt', 'bin.dat', 'gone.txt', 'old.txt'])
    expect(detail!.files.map(file => file.display)).toEqual(['a.txt', 'bin.dat', 'gone.txt', 'old.txt'])
    expect(detail!.total).toBe(4)
    // A rename whose origin lies outside the working directory keeps its new path without an origin.
    const secondDetail = await commit(runner, nested, second, signal, LIMITS)
    expect(secondDetail!.files.find(file => file.path === 'moved.txt')).toMatchObject({ kind: 'renamed' })
    expect(secondDetail!.files.find(file => file.path === 'moved.txt')!.from).toBeUndefined()
  })

  it('caps the file list while keeping the complete count', async () => {
    const { cwd, root } = await commitRepository()
    const detail = await commit(await harness(), cwd, root, signal, { ...LIMITS, maxFiles: 2 })
    expect(detail!.files.map(file => file.path)).toEqual(['other/move.txt', 'other/outside.txt'])
    expect(detail!.total).toBe(7)
  })

  it('answers undefined for a hash that names no commit', async () => {
    const { cwd } = await commitRepository()
    const runner = await harness()
    expect(await commit(runner, cwd, 'a'.repeat(40), signal, LIMITS)).toBeUndefined()
    expect(await commit(runner, cwd, git(cwd, 'rev-parse', 'HEAD^{tree}').trim(), signal, LIMITS)).toBeUndefined()
    expect(await commit(runner, cwd, 'not hex', signal, LIMITS)).toBeUndefined()
  })

  it('resolves an abbreviated hash', async () => {
    const { cwd, second } = await commitRepository()
    const detail = await commit(await harness(), cwd, second.slice(0, 7), signal, LIMITS)
    expect(detail!.commit.hash).toBe(second)
  })

  it('keeps a commit message that carries no trailing newline', async () => {
    const cwd = await scratchDir('dsh-history-message-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'f.txt'), 'f\n')
    git(cwd, 'add', '-A')
    const tree = git(cwd, 'write-tree').trim()
    await writeFile(join(cwd, 'message.txt'), 'no trailing newline')
    const created = git(cwd, 'commit-tree', tree, '-F', 'message.txt').trim()
    git(cwd, 'update-ref', 'refs/heads/main', created)
    const detail = await commit(await harness(), cwd, created, signal, LIMITS)
    expect(detail!.message).toBe('no trailing newline')
  })

  it('rejects a directory outside a repository and a truncated read', async () => {
    const { cwd, root } = await commitRepository()
    const plain = await scratchDir('dsh-history-commit-plain-', cleanups)
    await expect(commit(await harness(), plain, root, signal, LIMITS)).rejects.toThrow(/rev-parse/u)
    await expect(commit(await harness(30), cwd, root, signal, LIMITS)).rejects.toThrow(/exceeded/u)
  })
})

describe('commitDiff', () => {
  it('compares a commit’s modified file with its first parent', async () => {
    const { cwd, second } = await commitRepository()
    const diff = await commitDiff(await harness(), cwd, { hash: second, path: 'sub/a.txt' }, signal, LIMITS)
    expect(diff).toMatchObject({
      kind: 'text', path: 'sub/a.txt', display: 'sub/a.txt', before: true, after: true, coarse: false,
    })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual([' one', '-two', '+TWO', ' three', '+four'])
  })

  it('covers the whole file as context when the view asks for a complete comparison', async () => {
    const cwd = await scratchDir('dsh-history-complete-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    const lines = Array.from({ length: 20 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`)
    await writeFile(join(cwd, 'long.txt'), `${lines.join('\n')}\n`)
    commitAll(cwd, 'seed')
    const seed = headHash(cwd)
    await writeFile(join(cwd, 'long.txt'), `${[...lines.slice(0, 9), 'line-10 changed', ...lines.slice(10)].join('\n')}\n`)
    commitAll(cwd, 'change')
    const runner = await harness()
    const changed = await commitDiff(runner, cwd, { hash: headHash(cwd), path: 'long.txt' }, signal, LIMITS)
    expect(changed?.kind === 'text' ? changed.hunks.flatMap(hunk => hunk.lines) : []).toEqual([
      ' line-07', ' line-08', ' line-09', '-line-10', '+line-10 changed', ' line-11', ' line-12', ' line-13',
    ])
    const whole = await commitDiff(
      runner, cwd, { hash: headHash(cwd), path: 'long.txt', complete: true }, signal, LIMITS,
    )
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
    // A root commit's side holds no old lines, so its whole-file request keeps the additions alone.
    const root = await commitDiff(runner, cwd, { hash: seed, path: 'long.txt', complete: true }, signal, LIMITS)
    expect(root?.kind === 'text' ? root.hunks.flatMap(hunk => hunk.lines) : []).toEqual(lines.map(line => `+${line}`))
  })

  it('reports an added file and a deleted file as one-sided', async () => {
    const { cwd, second } = await commitRepository()
    const runner = await harness()
    const added = await commitDiff(runner, cwd, { hash: second, path: 'sub/new.txt' }, signal, LIMITS)
    expect(added).toMatchObject({ kind: 'text', before: false, after: true })
    expect(added?.kind === 'text' ? added.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['+new'])
    const removed = await commitDiff(runner, cwd, { hash: second, path: 'sub/gone.txt' }, signal, LIMITS)
    expect(removed).toMatchObject({ kind: 'text', before: true, after: false })
    expect(removed?.kind === 'text' ? removed.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['-bye'])
  })

  it('pairs a rename with its origin', async () => {
    const { cwd, second } = await commitRepository()
    const diff = await commitDiff(
      await harness(), cwd, { hash: second, path: 'sub/renamed.txt', from: 'sub/old.txt' }, signal, LIMITS,
    )
    expect(diff).toMatchObject({ kind: 'text', before: true, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual([' one', ' two', ' three', '-four', '+FOUR', ' five', ' six'])
  })

  it('answers a content-preserving rename and a mode-only change without hunks', async () => {
    const cwd = await scratchDir('dsh-history-pure-rename-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'before.txt'), 'same\n')
    commitAll(cwd, 'seed')
    git(cwd, 'mv', 'before.txt', 'after.txt')
    commitAll(cwd, 'rename only')
    const renamed = await commitDiff(await harness(), cwd, {
      hash: headHash(cwd), path: 'after.txt', from: 'before.txt',
    }, signal, LIMITS)
    expect(renamed).toMatchObject({ kind: 'text', before: true, after: true, hunks: [] })
  })

  it('reports binary files without lines', async () => {
    const { cwd, second } = await commitRepository()
    const runner = await harness()
    expect(await commitDiff(runner, cwd, { hash: second, path: 'sub/bin.dat' }, signal, LIMITS))
      .toMatchObject({ kind: 'binary', path: 'sub/bin.dat', display: 'sub/bin.dat' })
    // The root commit's binary addition is compared against the empty tree.
    expect(await commitDiff(runner, cwd, { hash: git(cwd, 'rev-list', '--max-parents=0', 'HEAD').trim(), path: 'sub/bin.dat' }, signal, LIMITS))
      .toMatchObject({ kind: 'binary' })
  })

  it('compares a root commit’s file against the empty tree', async () => {
    const { cwd, root } = await commitRepository()
    const diff = await commitDiff(await harness(), cwd, { hash: root, path: 'top.txt' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', before: false, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['+top'])
  })

  it('selects the named path literally when a name carries pathspec magic', async () => {
    // `a[1].txt` is a bracket expression to git unless the pathspecs are
    // literal, and it also matches `a1.txt`: without the environment the
    // comparison would draw the other file's hunks and drop this one's.
    const cwd = await scratchDir('dsh-history-literal-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'a1.txt'), 'plain\n')
    await writeFile(join(cwd, 'a[1].txt'), 'literal\n')
    commitAll(cwd, 'seed')
    await writeFile(join(cwd, 'a1.txt'), 'plain changed\n')
    await writeFile(join(cwd, 'a[1].txt'), 'literal changed\n')
    commitAll(cwd, 'both change')
    const runner = await harness()
    const magic = await commitDiff(runner, cwd, { hash: headHash(cwd), path: 'a[1].txt' }, signal, LIMITS)
    expect(magic).toMatchObject({ kind: 'text', path: 'a[1].txt', display: 'a[1].txt' })
    expect(magic?.kind === 'text' ? magic.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual(['-literal', '+literal changed'])
    const plain = await commitDiff(runner, cwd, { hash: headHash(cwd), path: 'a1.txt' }, signal, LIMITS)
    expect(plain?.kind === 'text' ? plain.hunks.flatMap(hunk => hunk.lines) : [])
      .toEqual(['-plain', '+plain changed'])
  })

  it('maps a nested working directory’s path and refuses paths outside it', async () => {
    const { cwd, root, second } = await commitRepository()
    const runner = await harness()
    const nested = join(cwd, 'sub')
    const diff = await commitDiff(runner, nested, { hash: root, path: 'a.txt' }, signal, LIMITS)
    expect(diff).toMatchObject({ kind: 'text', path: 'a.txt', display: 'a.txt', before: false, after: true })
    expect(diff?.kind === 'text' ? diff.hunks.flatMap(hunk => hunk.lines) : []).toEqual(['+one', '+two', '+three'])
    expect(await commitDiff(runner, nested, { hash: second, path: '../top.txt' }, signal, LIMITS)).toBeUndefined()
    expect(await commitDiff(runner, nested, { hash: second, path: 'a.txt', from: '../other/move.txt' }, signal, LIMITS))
      .toBeUndefined()
    expect(await commitDiff(runner, nested, { hash: second, path: 'moved.txt' }, signal, LIMITS))
      .toMatchObject({ kind: 'text', before: false, after: true })
  })

  it('answers undefined for an unknown commit, an unchanged path, or an invalid request', async () => {
    const { cwd, second } = await commitRepository()
    const runner = await harness()
    expect(await commitDiff(runner, cwd, { hash: 'b'.repeat(40), path: 'sub/a.txt' }, signal, LIMITS)).toBeUndefined()
    expect(await commitDiff(runner, cwd, { hash: 'not hex', path: 'sub/a.txt' }, signal, LIMITS)).toBeUndefined()
    expect(await commitDiff(runner, cwd, { hash: second, path: 'sub/none.txt' }, signal, LIMITS)).toBeUndefined()
    expect(await commitDiff(runner, cwd, { hash: second, path: 'sub/a.txt', from: '' }, signal, LIMITS)).toBeUndefined()
    expect(await commitDiff(runner, cwd, { hash: second, path: '' }, signal, LIMITS)).toBeUndefined()
  })

  it('reports a diff git cannot write as a failed read', async () => {
    const failed = fakeRunner((args) => {
      if (args[0] === 'rev-parse') return { stdout: `/repo\n\n${'a'.repeat(40)}\n` }
      return { exitCode: 1, stderr: 'fatal: bad pathspec' }
    })
    await expect(commitDiff(failed, '/work', { hash: 'a'.repeat(40), path: 'a.txt' }, signal, LIMITS))
      .rejects.toThrow(/git diff in \/work failed: fatal: bad pathspec/u)
  })

  it('reports a patch beyond the output cap as oversized', async () => {
    const { cwd, second } = await commitRepository()
    expect(await commitDiff(await harness(), cwd, { hash: second, path: 'sub/a.txt' }, signal,
      { ...LIMITS, outputMaxBytes: 120 }))
      .toMatchObject({ kind: 'oversized', path: 'sub/a.txt' })
  })

  it.skipIf(process.platform === 'win32')('does not run a repository-configured textconv driver', async () => {
    const cwd = await scratchDir('dsh-history-textconv-', cleanups)
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, '.gitattributes'), '*.txt diff=mine\n')
    await writeFile(join(cwd, 'a.txt'), 'one\n')
    commitAll(cwd, 'seed')
    const marker = join(cwd, 'textconv-ran')
    git(cwd, 'config', 'diff.mine.textconv', `sh -c 'touch ${marker}; cat "$1"' --`)
    await writeFile(join(cwd, 'a.txt'), 'two\n')
    commitAll(cwd, 'change')
    expect(await commitDiff(await harness(), cwd, { hash: headHash(cwd), path: 'a.txt' }, signal, LIMITS))
      .toMatchObject({ kind: 'text', before: true, after: true })
    expect(existsSync(marker)).toBe(false)
  })
})

/** A git runner answering fixed command facts, for output a real repository cannot produce. */
function fakeRunner(answer: (args: readonly string[]) => Partial<GitRunResult>): GitRunner {
  return {
    run: async (args: readonly string[]) => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, ...answer(args) }),
  } as never
}

/** One commit record in the `git show -s -z` fields the history reads parse. */
function showRecord(): string {
  return ['a'.repeat(40), 'aaaaaaa', '', 't', '2026-01-01T00:00:00+00:00', 'one', 'one\n'].join('\0') + '\0'
}

/** A runner that answers the commit read's commands, with the file listing overridable. */
function commitRunner(listing: { readonly numstat?: string; readonly raw?: string }): GitRunner {
  return fakeRunner((args) => {
    // The location and the resolved commit share one command: the verified
    // revision's id comes after the two location lines.
    if (args[0] === 'rev-parse') return { stdout: `/repo\n\n${'a'.repeat(40)}\n` }
    if (args[0] === 'show') return { stdout: showRecord() }
    // One command asks for both blocks, and git prints the raw one first.
    if (args.includes('--raw')) return { stdout: `${listing.raw ?? ''}${listing.numstat ?? ''}` }
    return { stdout: listing.numstat ?? '' }
  })
}

describe('malformed git output', () => {
  it('rejects a ref listing or log record set that lost its terminator', async () => {
    const refs = fakeRunner(() => ({ stdout: 'refs/heads/main\0hash\0\0*\0commit\0' }))
    await expect(historyRefs(refs, '/work', signal)).rejects.toThrow(/newline-terminated/u)
    const fields = fakeRunner(() => ({ stdout: 'refs/heads/main\0hash\0*\n' }))
    await expect(historyRefs(fields, '/work', signal)).rejects.toThrow(/malformed record/u)
    const log = fakeRunner(args => args[0] === 'for-each-ref' ? {} : { stdout: 'not a record' })
    await expect(history(log, '/work', { skip: 0, limit: 1 }, signal, LIMITS)).rejects.toThrow(/NUL-terminated/u)
    const odd = fakeRunner(args => args[0] === 'for-each-ref' ? {} : { stdout: 'a\0b\0' })
    await expect(history(odd, '/work', { skip: 0, limit: 1 }, signal, LIMITS)).rejects.toThrow(/malformed record/u)
  })

  it('rejects a log that failed while HEAD names a commit', async () => {
    const runner = fakeRunner((args) => {
      if (args[0] === 'for-each-ref') return {}
      if (args[0] === 'log') return { exitCode: 128, stderr: 'fatal: bad revision' }
      return { stdout: `${'a'.repeat(40)}\n` }
    })
    await expect(history(runner, '/work', { skip: 0, limit: 1 }, signal, LIMITS))
      .rejects.toThrow(/git log in \/work failed: fatal: bad revision/u)
  })

  it('rejects a commit read whose records or tree listing cannot be parsed', async () => {
    const noRecord = fakeRunner((args) => {
      if (args[0] === 'rev-parse') return { stdout: `/repo\n\n${'a'.repeat(40)}\n` }
      return {}
    })
    await expect(commit(noRecord, '/work', 'a'.repeat(40), signal, LIMITS)).rejects.toThrow(/printed no commit/u)
    await expect(commit(commitRunner({ raw: 'broken' }), '/work', 'a'.repeat(40), signal, LIMITS))
      .rejects.toThrow(/NUL-terminated/u)
    await expect(commit(commitRunner({ raw: 'not a raw record\0' }), '/work', 'a'.repeat(40), signal, LIMITS))
      .rejects.toThrow(/malformed numstat record/u)
    // A raw header that names no path, or a rename with no destination, is a
    // truncated listing rather than something the parser can complete.
    await expect(commit(commitRunner({ raw: ':100644 100644 aaaa bbbb M\0' }), '/work', 'a'.repeat(40), signal, LIMITS))
      .rejects.toThrow(/malformed record/u)
    await expect(commit(commitRunner({ raw: ':100644 100644 aaaa bbbb R100\0sub/old.txt\0' }), '/work', 'a'.repeat(40), signal, LIMITS))
      .rejects.toThrow(/malformed record/u)
  })

  it('rejects a commit or parent git cannot verify', async () => {
    const failed = fakeRunner(() => ({ exitCode: 128, stderr: 'fatal: cannot read' }))
    await expect(commit(failed, '/work', 'a'.repeat(40), signal, LIMITS)).rejects.toThrow(/rev-parse in \/work failed/u)
    const parentless = fakeRunner((args) => {
      // The commit resolves; asking for its parent is the read that fails.
      if (args[0] === 'rev-parse' && args.at(-1)?.endsWith('^{commit}') === true) return { stdout: `/repo\n\n${'a'.repeat(40)}\n` }
      if (args[0] === 'rev-parse') return { exitCode: 128, stderr: 'fatal: cannot read' }
      return {}
    })
    await expect(commitDiff(parentless, '/work', { hash: 'a'.repeat(40), path: 'a.txt' }, signal, LIMITS))
      .rejects.toThrow(/rev-parse in \/repo failed/u)
  })

  it('maps a copy record and a file without a raw status', async () => {
    const copied = await commit(commitRunner({
      numstat: '1\t1\t\0sub/old.txt\0sub/new.txt\0',
      raw: ':100644 100644 aaaa bbbb C100\0sub/old.txt\0sub/new.txt\0',
    }), '/work', 'a'.repeat(40), signal, LIMITS)
    expect(copied!.files).toEqual([
      { path: 'sub/new.txt', display: 'sub/new.txt', kind: 'renamed', from: 'sub/old.txt', added: 1, deleted: 1 },
    ])
    // A numstat record without a matching raw record keeps the modified kind.
    const statusless = await commit(commitRunner({ numstat: '1\t0\tsub/new.txt\0' }), '/work', 'a'.repeat(40), signal, LIMITS)
    expect(statusless!.files).toEqual([
      { path: 'sub/new.txt', display: 'sub/new.txt', kind: 'modified', added: 1, deleted: 0 },
    ])
  })
})
