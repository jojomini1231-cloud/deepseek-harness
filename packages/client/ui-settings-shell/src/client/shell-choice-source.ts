/** The shell executor choice: a Windows host's PowerShell or Git Bash selection, read and switched over the plugin manager. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChangeResult, ShellExecutorSelection } from '@deepseek-ai/dsh-api-remotes/client'

/** One selectable executor side. */
export type ShellExecutorChoice = 'pwsh' | 'git-bash'

/** A Remote answer as the generated client returns it. */
type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The plugin manager endpoints the choice row reads; the Host serves both only on Windows. */
export interface ShellChoiceRemote {
  getShellExecutorSelection(): Promise<Answer<ShellExecutorSelection>>
  setShellExecutor(choice: ShellExecutorChoice): Promise<Answer<ChangeResult>>
}

/** What a completed switch did; `restart-required` names the one outcome the Host cannot apply live. */
export type ShellChoiceOutcome = 'applied' | 'restart-required' | 'overridden' | 'failed'

/** Actual selection, optimistic switch, and the outcome of the last switch. */
export interface ShellChoiceSnapshot {
  state?: ShellExecutorSelection
  failed: boolean
  pending?: ShellExecutorChoice
  notice?: { sequence: number; outcome: ShellChoiceOutcome }
}

/**
 * Observe the host's shell executor selection and switch it. The Host owns
 * every fact: the source re-reads after each switch and after every
 * `plugin-manager/changed` event wired by the registration, so a change made
 * on another surface shows here without a manual refresh.
 */
export class ShellChoiceSource {
  /** Stable observation shared by the mounted row. */
  readonly store = createSnapshotStore<ShellChoiceSnapshot>({ failed: false })
  private live = true
  private sequence = 0

  /** @param remote - The plugin manager's selection endpoints. */
  constructor(private readonly remote: ShellChoiceRemote) {
    void this.refresh()
  }

  /** Read the current selection; a refused read leaves the last known state and marks the row failed. */
  async refresh(): Promise<void> {
    if (!this.isLive()) return
    const answer = await this.remote.getShellExecutorSelection()
    if (!this.isLive()) return
    if (!answer.ok) {
      this.store.set({ ...this.store.getSnapshot(), failed: true })
      return
    }
    const previous = this.store.getSnapshot()
    // A refresh while our own switch is in flight: the re-read is authoritative,
    // and a pending choice it already names is the confirmed present.
    const { pending, ...rest } = previous
    this.store.set({
      ...rest, state: answer.value, failed: false,
      ...(pending !== undefined && answer.value.active !== pending ? { pending } : {}),
    })
  }

  /**
   * Switch the composed executor rows and report what the Host did with it.
   * @param choice - The executor side to compose.
   * @returns After the Host settles the switch.
   */
  async select(choice: ShellExecutorChoice): Promise<void> {
    if (!this.isLive() || this.store.getSnapshot().pending !== undefined) return
    const state = this.store.getSnapshot().state
    if (state?.supported === true && state.active === choice) return
    const { notice: _notice, ...previous } = this.store.getSnapshot()
    this.store.set({ ...previous, pending: choice })
    const answer = await this.remote.setShellExecutor(choice)
    if (!this.isLive()) return
    const { pending: _pending, ...current } = this.store.getSnapshot()
    const value = answer.ok ? answer.value : undefined
    const outcome: ShellChoiceOutcome = !answer.ok || value === undefined || value.application === 'failed'
      ? 'failed'
      : value.application === 'applied' ? 'applied'
        : value.application === 'overridden' ? 'overridden'
          : value.application === 'restart-required' ? 'restart-required' : 'applied'
    this.store.set({ ...current, notice: { sequence: ++this.sequence, outcome } })
    // `restart-required` keeps the running selection as the visible one; every other outcome re-reads it.
    if (outcome !== 'restart-required') await this.refresh()
  }

  /** Retire the notice whose animation completed.
   * @param sequence - the notice sequence the toast reports as done.
   */
  dismissNotice(sequence: number): void {
    const current = this.store.getSnapshot()
    if (current.notice?.sequence !== sequence) return
    const { notice: _notice, ...next } = current
    this.store.set(next)
  }

  private isLive(): boolean { return this.live }

  /** Ignore late Host responses. */
  dispose(): void { this.live = false }
}
