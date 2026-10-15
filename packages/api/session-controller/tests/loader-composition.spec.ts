/**
 * REAL-composition proof for workspace-less Session creation: the shipped YAML
 * rows — the storage hub with a mounted domain, the Session store and JSONL
 * persistence, the projection registry, the Agent plane (LLM, model default,
 * Agent registry and loop, tools, system prompt, working directory), the
 * attachment and file-upload owners, the Session query engine, the Workspace
 * registry, and both Host controllers — boot through the vendored Loader.
 *
 * One `session.create({ temporary })` then leaves the durable, user-visible
 * results the feature promises: a per-Session directory under the configured
 * temporary root, the Session header pointing at it, the id present in the
 * registry's temporary set, and that set in the Workspace baseline.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceController from '@deepseek-ai/dsh-api-workspace-controller'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'

let root: string | undefined
let context: Context | undefined

/**
 * Import mapped source modules without claiming support for Node's HMR internals.
 * @param importModule - the specifier-to-module resolver this composition owns.
 * @returns a v2 loader whose Node-internal operations fail loud when reached.
 */
function sourceModuleLoader(importModule: (specifier: string) => Promise<unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    import: importModule,
    loadCache: new Map(),
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('temporary Session creation under real Loader composition', () => {
  it('derives the directory from the id, records the Session temporary, and reports it over the feed', async () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-temporary-loader-')))
    root = base
    const documents = join(base, 'documents')
    const temporaryRoot = join(base, 'temp-root')
    const home = join(base, 'home')
    mkdirSync(documents, { recursive: true })
    mkdirSync(home, { recursive: true })
    const configPath = join(base, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-typert-registry'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(home, 'storages'))}`,
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(home, 'sessions'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-working-directory'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-agent-default-model'",
      '  config:',
      '    provider: test-provider',
      '    model: test-model',
      "- name: '@deepseek-ai/dsh-agent-loop'",
      "- name: '@deepseek-ai/dsh-attachment-local'",
      '  config:',
      `    dshHome: ${JSON.stringify(home)}`,
      "- name: '@deepseek-ai/dsh-client-file-upload'",
      "- name: '@deepseek-ai/dsh-session-query-sqlite'",
      '  config:',
      "    path: ':memory:'",
      '    openAt: never',
      "- name: '@deepseek-ai/dsh-workspace'",
      "- name: '@deepseek-ai/dsh-api-workspace-controller'",
      '  config:',
      `    documentsDirectory: ${JSON.stringify(documents)}`,
      `    temporaryWorkspaceDirectory: ${JSON.stringify(temporaryRoot)}`,
      "- name: '@deepseek-ai/dsh-api-session-controller'",
      '  config:',
      '    nativeOpen: false',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = `${pathToFileURL(base).href}/`
    // The file-upload owner registers a streaming route on the Connection seam;
    // no carrier exists in this Host-only composition.
    ctx.provide('connection', { fetch: { register: () => () => Promise.resolve() } } as never)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', StorageJson],
      ['@deepseek-ai/dsh-session-persistence-jsonl', SessionPersistenceJsonl],
      ['@deepseek-ai/dsh-storage-domain', StorageDomain],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-working-directory', WorkingDirectory],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
      ['@deepseek-ai/dsh-client-file-upload', FileUploads],
      ['@deepseek-ai/dsh-session-query-sqlite', SqliteSessionQueryEngine],
      ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
      ['@deepseek-ai/dsh-api-workspace-controller', WorkspaceController],
      ['@deepseek-ai/dsh-api-session-controller', SessionController],
    ])
    ctx.loader.internal = sourceModuleLoader(async (specifier) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    })
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const unloaded = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const sessionId = SessionId('temporary-session-1')
    const created = await ctx.sessionController.create({ sessionId, temporary: true })

    expect(created.sessionId).toBe(sessionId)
    const expectedDirectory = join(temporaryRoot, sessionId)
    expect(existsSync(expectedDirectory)).toBe(true)
    expect(ctx.sessions.get(sessionId)?.header.cwd).toBe(expectedDirectory)
    expect(ctx.workspaceRegistry.temporarySessionIds).toEqual([sessionId])

    const abort = new AbortController()
    try {
      const iterator = ctx.workspaceController.follow(abort.signal)[Symbol.asyncIterator]()
      const first = await iterator.next()
      expect(first.value).toMatchObject({
        type: 'baseline',
        value: { temporarySessionIds: [sessionId] },
      })
      await iterator.return?.()
    } finally {
      abort.abort()
    }
  })
})
