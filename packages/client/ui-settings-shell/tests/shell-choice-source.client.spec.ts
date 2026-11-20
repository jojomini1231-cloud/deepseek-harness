/** The choice source's read, optimistic switch, and outcome surfaces. */
import { describe, expect, it, vi } from 'vitest'
import type { ChangeResult, ShellExecutorSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { ShellChoiceSource, type ShellChoiceRemote, type ShellExecutorChoice } from '../src/client/shell-choice-source.ts'

/** One supported Host view; `gitBashPath` present, as a real Windows host reports it. */
function selection(active?: ShellExecutorChoice): { ok: true; value: ShellExecutorSelection } {
  return { ok: true, value: { supported: true, ...(active !== undefined ? { active } : {}), gitBashPath: 'C:\\Git\\bin\\bash.exe' } }
}

/** One accepted change outcome, as the plugin manager reports it. */
function change(application: NonNullable<ChangeResult['application']>): { ok: true; value: ChangeResult } {
  return { ok: true, value: { changed: true, application, stage: 'enable', target: 'bash-sandbox', enabled: true } }
}

/** One refused Remote answer. */
function refused(): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code: 'gateway/internal', message: 'no provider' } }
}

/** A scripted choice remote; reads default to an unsupported Host until a spec says otherwise. */
function script(): ShellChoiceRemote & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
} {
  const get = vi.fn(() => Promise.resolve(selection('pwsh')))
  const set = vi.fn(() => Promise.resolve(change('applied')))
  return { getShellExecutorSelection: get, setShellExecutor: set, get, set }
}

describe('ShellChoiceSource', () => {
  it('reads the selection at construction', async () => {
    const remote = script()
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(source.store.getSnapshot().state).toMatchObject({ supported: true, active: 'pwsh' }) })
    expect(source.store.getSnapshot().failed).toBe(false)
  })

  it('marks the row failed when the read is refused, keeping the last state', async () => {
    const remote = script()
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(source.store.getSnapshot().state).toBeDefined() })

    remote.get.mockResolvedValueOnce(refused())
    await source.refresh()

    const snapshot = source.store.getSnapshot()
    expect(snapshot.failed).toBe(true)
    expect(snapshot.state).toMatchObject({ active: 'pwsh' })
  })

  it('switches optimistically and confirms the new active', async () => {
    const remote = script()
    remote.get.mockResolvedValueOnce(selection('pwsh')).mockResolvedValue(selection('git-bash'))
    const source = new ShellChoiceSource(remote)
    await source.select('git-bash')

    const snapshot = source.store.getSnapshot()
    expect(remote.set).toHaveBeenCalledWith('git-bash')
    expect(snapshot.pending).toBeUndefined()
    expect(snapshot.state).toMatchObject({ active: 'git-bash' })
    expect(snapshot.notice).toMatchObject({ sequence: 1, outcome: 'applied' })
  })

  it('skips a redundant switch and one already in flight', async () => {
    const remote = script()
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(source.store.getSnapshot().state).toBeDefined() })

    await source.select('pwsh')
    expect(remote.set).not.toHaveBeenCalled()

    let release: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => { release = resolve })
    remote.set.mockReturnValueOnce(inFlight.then(() => change('applied')))
    const switching = source.select('git-bash')
    expect(source.store.getSnapshot().pending).toBe('git-bash')

    await source.select('pwsh')
    expect(remote.set).toHaveBeenCalledTimes(1)
    release()
    await switching
    expect(source.store.getSnapshot().notice).toMatchObject({ outcome: 'applied' })
  })

  it('reports an overlay override and re-reads the selection', async () => {
    const remote = script()
    remote.set.mockResolvedValue(change('overridden'))
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledTimes(1) })

    await source.select('git-bash')

    expect(source.store.getSnapshot().notice).toMatchObject({ outcome: 'overridden' })
    expect(remote.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the running selection visible when a restart is required', async () => {
    const remote = script()
    remote.set.mockResolvedValue(change('restart-required'))
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledTimes(1) })

    await source.select('git-bash')

    const snapshot = source.store.getSnapshot()
    expect(snapshot.notice).toMatchObject({ outcome: 'restart-required' })
    expect(snapshot.state).toMatchObject({ active: 'pwsh' })
    expect(remote.get).toHaveBeenCalledTimes(1)
  })

  it('reports a refused switch as failed and keeps the last state', async () => {
    const remote = script()
    remote.set.mockResolvedValue(refused())
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(source.store.getSnapshot().state).toBeDefined() })

    await source.select('git-bash')

    const snapshot = source.store.getSnapshot()
    expect(snapshot.notice).toMatchObject({ outcome: 'failed' })
    expect(snapshot.state).toMatchObject({ active: 'pwsh' })
  })

  it('ignores late answers after disposal', async () => {
    const remote = script()
    const source = new ShellChoiceSource(remote)
    await vi.waitFor(() => { expect(source.store.getSnapshot().state).toBeDefined() })

    let release: () => void = () => {}
    remote.set.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }).then(() => change('applied')))
    const switching = source.select('git-bash')
    source.dispose()
    release()
    await switching

    expect(source.store.getSnapshot().notice).toBeUndefined()
  })

  it('retires only the notice whose animation completed', async () => {
    const remote = script()
    const source = new ShellChoiceSource(remote)
    await source.select('git-bash')
    expect(source.store.getSnapshot().notice).toMatchObject({ sequence: 1, outcome: 'applied' })

    source.dismissNotice(2)
    expect(source.store.getSnapshot().notice).toBeDefined()

    source.dismissNotice(1)
    expect(source.store.getSnapshot().notice).toBeUndefined()
  })
})
