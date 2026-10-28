/**
 * Workspace-less temporary Sessions through the shipped Web composition: the
 * separate sidebar entry, the Temporary Workspaces bucket ordered after the
 * real Workspaces, and the live composer for a Session with no Workspace.
 *
 * Zero model calls: session.create and workspace.* are host RPCs, and the one
 * ordinary Session row the tree needs comes from a seeded fixture reused
 * read-only (the seeded-history seed — no new recording).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/temporary-workspace', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const DELETED_EXPECTED = join(SNAPSHOT_DIR, 'deleted.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: temporary workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const seeded = await seedSession(scaffold, await readFile(SEED, 'utf8'), 'temporary-workspace-web-e2e')
    await workspace.attachSession(seeded)
    // CI uses Playwright's pinned browser; a developer may point this at an
    // installed Chromium when the matching download is unavailable.
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('starts a workspace-less Session and lists it in the Temporary section', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-temporary-workspace'))
    // Both sections share one scroller and render as sibling trees, so the
    // region is scoped to the scroller rather than to either tree.
    const sidebar = page.locator('[class*="treeBody"]')
    const workspaceTitle = basename(scaffold.workspaceCwd)
    await sidebar.getByText(workspaceTitle, { exact: true }).waitFor({ timeout: 15_000 })

    // The sidebar's own workspace-less entry starts the Session; the Host
    // creates its directory and the row lands in the Temporary section. The
    // section header carries a create button with the same label, so the entry
    // is selected by the sidebar control's class.
    await page.locator('button[class*="newTemporary"]').click()

    // The section header renders whether or not it holds a Session, so its
    // label is present from the first paint and cannot mark creation. The
    // created row inside the temporary tree is the observable commit.
    const temporaryTree = sidebar.getByRole('tree', { name: 'Temporary workspaces' })
    await temporaryTree.getByRole('treeitem').first().waitFor({ timeout: 15_000 })

    // The registry recorded exactly the Session the Host created, and its
    // directory is the per-Session leaf under the configured temporary root.
    const temporaryIds = scaffold.ctx.workspaceRegistry.temporarySessionIds
    expect(temporaryIds).toHaveLength(1)
    const cwd = scaffold.ctx.sessions.get(temporaryIds[0]!)?.header.cwd
    expect(cwd).toBe(join(
      scaffold.workspaceCwd, 'Documents', 'deepseek-harness', 'temporary-workspaces', temporaryIds[0]!,
    ))

    // The composer is live without a Workspace: the chip names the group and
    // never the Session-derived directory.
    const chip = page.getByRole('button', { name: 'Choose workspace' })
    await expect.poll(() => chip.textContent()).toBe('Temporary workspace')

    await compareOrRefreshGolden(
      SIDEBAR_EXPECTED,
      await captureStableAria(page, '[class*="treeBody"]', scaffold.workspaceCwd),
      MODE,
    )

    expect(tripwire.pageErrors).toEqual([])
  })

  it('deletes the temporary Session, its subagent, its log, and its directory from the row menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-temporary-workspace-delete'))
    const sidebar = page.locator('[class*="treeBody"]')
    const temporaryTree = sidebar.getByRole('tree', { name: 'Temporary workspaces' })

    // A provisional New Session row has no content yet and therefore no row
    // verbs, so the Session this test deletes is seeded with a recorded turn
    // and classified temporary, with its directory where the entry point would
    // have put it. That keeps the model out of the case while exercising the
    // same row the product renders.
    const sessionId = brandString<SessionId>('temporary-workspace-delete-web-e2e')
    const directory = join(
      scaffold.workspaceCwd, 'Documents', 'deepseek-harness', 'temporary-workspaces', sessionId,
    )
    await mkdir(directory, { recursive: true })
    await seedSession(scaffold, await readFile(SEED, 'utf8'), sessionId, undefined, { cwd: directory })
    await scaffold.ctx.workspaceRegistry.markTemporarySession(sessionId)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    // The reload restores the blank New Session placeholder the first case
    // left selected, and that row carries no verbs (nothing has happened in it
    // yet), so the row under test is selected by its own seeded title.
    const row = temporaryTree.getByRole('treeitem').filter({ hasText: 'Untitled' })
    await row.waitFor({ timeout: 15_000 })
    expect(existsSync(directory)).toBe(true)

    // The row's "..." menu carries the deletion as its last, destructive entry.
    await row.hover()
    await row.getByRole('button', { name: /Session actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Delete session' }).click()

    // Deletion is permanent, so it asks first and says so.
    const dialog = page.getByRole('dialog', { name: 'Permanently delete this temporary session?' })
    await dialog.waitFor({ timeout: 10_000 })

    // The Session under test owns a subagent: its header carries the parent and
    // the subagent origin, and it holds no temporary classification of its own,
    // so this deletion is the only surface that can remove it. It is seeded
    // behind the UI, after the row was resolved, so the tree keeps one row with
    // the seeded title.
    const childId = brandString<SessionId>('temporary-workspace-delete-child-web-e2e')
    await seedSession(scaffold, await readFile(SEED, 'utf8'), childId, undefined, {
      cwd: directory,
      subagentOf: { parentSession: sessionId, delegationDepth: 1 },
    })
    expect((await scaffold.ctx.sessionPersistence.stat(childId))?.header.parentSession).toBe(sessionId)

    await dialog.getByRole('button', { name: 'Delete session' }).click()

    // The row leaves the Temporary section and the Host removes both the
    // stored log and the Session-local directory. The blank New Session
    // placeholder the section always carries is not the row under test.
    await expect.poll(() => row.count()).toBe(0)
    // The section may hold Sessions another case created; this one must be gone.
    expect(scaffold.ctx.workspaceRegistry.temporarySessionIds).not.toContain(sessionId)
    await expect.poll(() => existsSync(directory)).toBe(false)
    await expect.poll(async () => (await scaffold.ctx.sessionPersistence.stat(sessionId)) === undefined)
      .toBe(true)
    // The child Session went with its root instead of stranding the deletion.
    await expect.poll(async () => (await scaffold.ctx.sessionPersistence.stat(childId)) === undefined)
      .toBe(true)

    await compareOrRefreshGolden(
      DELETED_EXPECTED,
      await captureStableAria(page, '[class*="treeBody"]', scaffold.workspaceCwd),
      MODE,
    )

    expect(tripwire.pageErrors).toEqual([])
    // The one ordinary Session row the seeded fixture supplied is untouched.
    expect(await sidebar.getByRole('treeitem').count()).toBe(3)
    await assertFixtureInventory(SNAPSHOT_DIR, ['sidebar.expected.md', 'deleted.expected.md'])
  })
})
