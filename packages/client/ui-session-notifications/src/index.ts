/** Host Loader entry declaring the Session notification switches; raising notifications belongs to the Client. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SessionNotificationsConfig } from './types.ts'

/** Notification switches synced to the browser. */
export type Config = SessionNotificationsConfig

/** Notification switches synced to the browser; every field is user-facing and changes without reload. */
export const Config = Schema.object({
  notifyPendingInteraction: Schema.boolean().default(true).volatile(),
  notifyCompletion: Schema.boolean().default(true).volatile(),
  notifyOnlyWhenUnfocused: Schema.boolean().default(true).volatile(),
})

/**
 * Register the browser plugin without Host behavior; the Loader validates the entry's Config, and the browser face
 * receives its volatile fields.
 * @param _ctx - Host context; unused.
 * @param _config - validated switches; unused on the Host.
 */
export function apply(_ctx: Context, _config: Config): void {}
