/**
 * The General settings row over the Workspace controller's entry: it stages the
 * temporary root as a draft and writes it only on Save, so a half-typed path
 * never reaches the Host.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  TEMPORARY_DIRECTORY_FIELD,
  TemporaryWorkspaceRowController,
  type TemporaryWorkspaceSettings,
} from '../src/client/settings/temporary-workspace-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites(host: StubConfigForm<TemporaryWorkspaceSettings>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value, user })
    return Promise.resolve(true)
  })
}

describe('TemporaryWorkspaceRowController', () => {
  it('projects the configured root and stages an edit without writing it', () => {
    const host = stubConfigForm<TemporaryWorkspaceSettings>()
    const controller = new TemporaryWorkspaceRowController(host.scope, () => Promise.resolve(null))
    host.publish({
      status: 'ready', writable: true,
      value: { [TEMPORARY_DIRECTORY_FIELD]: '/data/temporary' }, user: {},
    })
    const face = controller.inject()

    expect(face.hooks.temporaryWorkspace.getSnapshot().directory).toMatchObject({
      text: '/data/temporary', overridden: false,
    })

    face.edit(TEMPORARY_DIRECTORY_FIELD, '/data/other')
    expect(face.hooks.temporaryWorkspace.getSnapshot().dirty).toBe(true)
    // The staged value never reaches the Host before Save.
    expect(host.mutate).not.toHaveBeenCalled()

    face.save()
    expect(host.mutate).toHaveBeenCalledOnce()
    expect(host.mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: [TEMPORARY_DIRECTORY_FIELD], value: '/data/other' },
    ])
  })

  it('stages a browsed directory and leaves a cancelled pick untouched', async () => {
    const host = stubConfigForm<TemporaryWorkspaceSettings>()
    let next: string | null = '/picked/root'
    const controller = new TemporaryWorkspaceRowController(host.scope, () => Promise.resolve(next))
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    await face.browse()
    expect(face.hooks.temporaryWorkspace.getSnapshot().directory).toMatchObject({
      text: '/picked/root', overridden: true,
    })
    expect(face.hooks.temporaryWorkspace.getSnapshot().dirty).toBe(true)

    next = null
    await face.browse()
    // A cancelled pick keeps whatever the user had staged.
    expect(face.hooks.temporaryWorkspace.getSnapshot().directory.text).toBe('/picked/root')
  })

  it('clears the profile entry on reset so the Host derives the Documents default', () => {
    const host = stubConfigForm<TemporaryWorkspaceSettings>()
    acceptWrites(host)
    host.publish({
      status: 'ready', writable: true,
      value: { [TEMPORARY_DIRECTORY_FIELD]: '/data/temporary' },
      base: {}, user: { [TEMPORARY_DIRECTORY_FIELD]: '/data/temporary' },
    })
    const controller = new TemporaryWorkspaceRowController(host.scope, () => Promise.resolve(null))
    const face = controller.inject()

    face.resetField(TEMPORARY_DIRECTORY_FIELD)
    face.save()

    expect(host.mutate).toHaveBeenCalledWith([{ op: 'unset', path: [TEMPORARY_DIRECTORY_FIELD] }], undefined)
    expect(face.hooks.temporaryWorkspace.getSnapshot()).toMatchObject({
      dirty: false,
      directory: { text: '', overridden: false },
    })
  })

  it('releases its subscription on dispose', () => {
    const host = stubConfigForm<TemporaryWorkspaceSettings>()
    const controller = new TemporaryWorkspaceRowController(host.scope, () => Promise.resolve(null))
    const listener = vi.fn()
    controller.inject().hooks.temporaryWorkspace.subscribe(listener)
    expect(host.listenerCount()).toBe(1)

    controller.dispose()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })

    // The row stops following the Host once it is disposed.
    expect(host.listenerCount()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })
})
