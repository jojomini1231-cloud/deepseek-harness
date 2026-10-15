// @vitest-environment jsdom
/**
 * The General settings row as Settings renders it: the one directory field, its
 * hint, and the three ways to fill it — typing, resetting, and the Host picker.
 * The row owns no logic of its own; it forwards each gesture to the face the
 * controller injects, so these are the wiring guarantees the slot expects.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TEMPORARY_DIRECTORY_FIELD } from '../src/client/settings/temporary-workspace-controller.ts'
import type { TemporaryWorkspaceRowState } from '../src/client/settings/temporary-workspace-controller.ts'
import { TemporaryWorkspaceRow } from '../src/client/settings/TemporaryWorkspaceRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: PropsLocale<'workspace'>['t'] = makeTranslate(en, commonEn)

// Every fixture carries the resource hook the resources plugin merges into
// GlobalStandardProps. The row reads none of the standard kit.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const unusedHook = (() => { throw new Error('unused by the temporary workspace row') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook,
  usePanelInfo, useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
  ...allowAllAccess,
}

function renderRow(state: Partial<TemporaryWorkspaceRowState> = {}) {
  const store = createSnapshotStore<TemporaryWorkspaceRowState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    directory: { text: '', overridden: false, invalid: false },
    ...state,
  })
  const actions = {
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    browse: vi.fn(() => Promise.resolve()),
  }
  render(<TemporaryWorkspaceRow {...kit} {...actions} t={t} useTemporaryWorkspace={bindSnapshotSelector(store)} />)
  return actions
}

describe('TemporaryWorkspaceRow', () => {
  it('renders the configured root with its hint and an empty field by default', () => {
    renderRow()

    expect(screen.getByText(en['temporaryDirectory.title'])).toBeTruthy()
    expect(screen.getByText(en['temporaryDirectory.description'])).toBeTruthy()
    const field = screen.getByLabelText<HTMLInputElement>(en['temporaryDirectory.field'])
    expect(field.value).toBe('')
    expect(screen.getByText(en['temporaryDirectory.hint'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['temporaryDirectory.browse'] })).toBeTruthy()
  })

  it('forwards a typed path to the field edit and a reset to the field reset', () => {
    const injected = renderRow({ directory: { text: '/data/temporary', overridden: true, invalid: false } })

    fireEvent.change(
      screen.getByLabelText(en['temporaryDirectory.field']),
      { target: { value: '/data/other' } },
    )
    expect(injected.edit).toHaveBeenCalledExactlyOnceWith(TEMPORARY_DIRECTORY_FIELD, '/data/other')

    fireEvent.click(screen.getByRole('button', { name: en['temporaryDirectory.reset'] }))
    expect(injected.resetField).toHaveBeenCalledExactlyOnceWith(TEMPORARY_DIRECTORY_FIELD)
  })

  it('opens the Host picker from the browse control', () => {
    const injected = renderRow()

    fireEvent.click(screen.getByRole('button', { name: en['temporaryDirectory.browse'] }))

    expect(injected.browse).toHaveBeenCalledOnce()
  })

  it('disables both the field and browse while the profile is read-only', () => {
    renderRow({ writable: false })

    expect(screen.getByLabelText<HTMLInputElement>(en['temporaryDirectory.field']).disabled).toBe(true)
    expect(screen.getByRole('button', { name: en['temporaryDirectory.browse'] }).hasAttribute('disabled')).toBe(true)
  })
})
