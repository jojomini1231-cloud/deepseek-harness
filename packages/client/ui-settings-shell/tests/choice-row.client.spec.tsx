// @vitest-environment jsdom
/** The Windows shell-choice row: hidden off Windows, disabled without Git Bash, and its switch toast. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ShellChoiceRow, ShellChoiceToast } from '../src/client/ShellChoiceRow.tsx'
import type { ShellChoiceSnapshot } from '../src/client/shell-choice-source.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

type RowProps = Parameters<typeof ShellChoiceRow>[0]
const t: RowProps['t'] = key => (en as Record<string, string>)[key] ?? key

// The row consumes none of the global standard kit; the props type demands it.
const unusedHook = (() => { throw new Error('unused by settings-shell components') }) as never
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const useSessionStatus: GlobalStandardProps['useSessionStatus'] = selector => selector(new Map())
const kit = {
  useSessions: unusedHook, useSessionStatus,
  usePanelInfo, useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
  ...allowAllAccess, useContextMenu: contextMenuHook(),
}

/** Render the row over one snapshot, returning its re-render handle. */
function renderRow(snapshot: ShellChoiceSnapshot, select = vi.fn(() => Promise.resolve())) {
  const view = render(<ShellChoiceRow {...kit} t={t} useChoice={bindSnapshotSelector(createSnapshotStore(snapshot))} select={select} />)
  return (next: ShellChoiceSnapshot) => {
    view.rerender(<ShellChoiceRow {...kit} t={t} useChoice={bindSnapshotSelector(createSnapshotStore(next))} select={select} />)
  }
}

describe('ShellChoiceRow', () => {
  it('stays hidden on a Host that reports no supported selection', () => {
    renderRow({ failed: false })
    expect(screen.queryByRole('group')).toBeNull()

    renderRow({ failed: true })
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('shows the active executor and switches through its menu', () => {
    const select = vi.fn(() => Promise.resolve())
    const rerender = renderRow({ failed: false, state: { supported: true, active: 'pwsh', gitBashPath: 'C:\\Git\\bin\\bash.exe' } }, select)

    const control = screen.getByRole('button', { name: en.choiceTitle })
    expect(screen.getByRole('group', { name: en.choiceTitle }).textContent).toContain(en.choiceDescription)
    expect(control.textContent).toBe(en.choicePwsh)

    fireEvent.click(control)
    fireEvent.click(screen.getByRole('menuitem', { name: en.choiceGitBash }))
    expect(select).toHaveBeenCalledWith('git-bash')

    rerender({ failed: false, state: { supported: true, active: 'git-bash', gitBashPath: 'C:\\Git\\bin\\bash.exe' }, pending: 'git-bash' })
    expect(control.textContent).toBe(en.choiceGitBash)
    expect(control.getAttribute('aria-busy')).toBe('true')
    expect(control.hasAttribute('disabled')).toBe(true)
  })

  it('explains and blocks Git Bash when the Host finds no installation', () => {
    renderRow({ failed: false, state: { supported: true, active: 'pwsh' } })

    fireEvent.click(screen.getByRole('button', { name: en.choiceTitle }))

    const gitBash = screen.getByRole('menuitem', { name: en.choiceGitBash })
    expect(gitBash.hasAttribute('disabled')).toBe(true)
    expect(gitBash.textContent).toContain(en.choiceGitBash)
  })

  it('reports a refused read without hiding the control', () => {
    renderRow({ failed: true, state: { supported: true, active: 'pwsh', gitBashPath: 'C:\\Git\\bin\\bash.exe' } })

    expect(screen.getByRole('alert').textContent).toBe(en.choiceReadError)
    expect(screen.getByRole('button', { name: en.choiceTitle }).textContent).toBe(en.choicePwsh)
  })

  it('says no shell is composed and disables the control until one is', () => {
    const rerender = renderRow({ failed: false, state: { supported: true } })

    const control = screen.getByRole('button', { name: en.choiceTitle })
    expect(screen.getByRole('alert').textContent).toBe(en.choiceUnavailable)
    expect(control.textContent).toBe(en.choiceUnavailable)
    expect(control.hasAttribute('disabled')).toBe(true)

    rerender({ failed: false, state: { supported: true, active: 'pwsh', gitBashPath: 'C:\\Git\\bin\\bash.exe' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(control.hasAttribute('disabled')).toBe(false)
  })
})

describe('ShellChoiceToast', () => {
  it('announces a completed switch and dismisses after its display lifetime', async () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const store = createSnapshotStore<ShellChoiceSnapshot>({ failed: false, notice: { sequence: 7, outcome: 'applied' } })
    const view = render(<ShellChoiceToast {...kit} t={t} useChoice={bindSnapshotSelector(store)} dismiss={dismiss} />)
    try {
      expect(screen.getByRole('alert').textContent).toBe(en['choiceResult.applied'])
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
      expect(dismiss).toHaveBeenCalledWith(7)
    } finally { view.unmount() }
  })

  it.each(['restart-required', 'overridden', 'failed'] as const)('warns on a %s outcome', (outcome) => {
    const store = createSnapshotStore<ShellChoiceSnapshot>({ failed: false, notice: { sequence: 1, outcome } })
    const view = render(<ShellChoiceToast {...kit} t={t} useChoice={bindSnapshotSelector(store)} dismiss={vi.fn()} />)
    try {
      expect(screen.getByRole('alert').textContent).toBe(en[`choiceResult.${outcome}`])
      expect(screen.queryByRole('img', { name: en['choiceResult.applied'] })).toBeNull()
    } finally { view.unmount() }
  })

  it('renders nothing without a notice', () => {
    const store = createSnapshotStore<ShellChoiceSnapshot>({ failed: false })
    const view = render(<ShellChoiceToast {...kit} t={t} useChoice={bindSnapshotSelector(store)} dismiss={vi.fn()} />)
    expect(view.container.textContent).toBe('')
  })
})
