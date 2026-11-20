/** Notification switches declared on the Host and synced to the browser. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'

it('registers no Host behavior', () => {
  expect(() => { apply(new Context(), Config({})) }).not.toThrow()
})

it('enables every notification class and focus suppression by default', () => {
  const config = Config({})
  expect(config.notifyPendingInteraction.get()).toBe(true)
  expect(config.notifyCompletion.get()).toBe(true)
  expect(config.notifyOnlyWhenUnfocused.get()).toBe(true)
})

it('keeps an explicit false', () => {
  const config = Config({ notifyPendingInteraction: false, notifyCompletion: false, notifyOnlyWhenUnfocused: false })
  expect(config.notifyPendingInteraction.get()).toBe(false)
  expect(config.notifyCompletion.get()).toBe(false)
  expect(config.notifyOnlyWhenUnfocused.get()).toBe(false)
})
