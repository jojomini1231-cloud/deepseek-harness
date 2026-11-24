// The sidebar strip and the queue pill answer a background Session's approval
// without switching to that Session's composer.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/approval-composer', import.meta.url))
// Reuses the composer fixture: its ask is a Read Only command that escalates to
// workspace-write, so both surfaces answer the same real request.
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()

const TOKENS = Array.from({ length: 220 }, (_, index) => `tok${((index + 1) * 7919 % 99991).toString(36)}`).join(' ')
/** The justification inside the request's structured escalation reason. */
const ACTION = 'Need to write the notes.txt file as requested by the user.'
const PROMPT = `Write a file named notes.txt in the workspace containing exactly this text on one line: ${TOKENS}. Use one bash command with the literal text inline. Then reply with the single word DONE and stop.`

/** The one Session row in the sidebar, identified by its own actions button. */
function sessionRow(page: Page) {
  return page.locator('[role="treeitem"]')
    .filter({ has: page.locator('button[aria-label^="Session actions for "]') })
    .last()
}

describe.skipIf(MODE === 'record')('web e2e: approval answer surfaces', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15 })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('answers from the sidebar strip and mirrors the same request in the queue', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-approval-surfaces'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('[aria-label^="Access mode"]').click()
    await page.getByRole('menuitem', { name: 'Read Only' }).click()
    await expect.poll(
      () => page.locator('[aria-label="Access mode, current: Read Only"]').count(),
      { timeout: 15_000 },
    ).toBe(1)

    const settled = scaffold.whenTurnSettled(120_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    // Both surfaces read one pending request; the composer keeps its own card.
    await page.locator('[data-approval-key]').waitFor({ timeout: 60_000 })
    const pill = page.locator('[data-approval-pill]')
    await pill.waitFor({ timeout: 15_000 })
    expect(await pill.getAttribute('aria-label')).toBe('1 awaiting decision')

    // The queue lists the same request and grants it in one click.
    await pill.click()
    const panel = page.locator('[data-approval-inbox]')
    await panel.waitFor({ timeout: 5_000 })
    expect(await panel.innerText()).toContain(ACTION)
    // The queue spans Sessions, so the card names the one the decision lands in.
    const sessionLine = panel.locator('[data-approval-session]')
    expect(await sessionLine.count()).toBe(1)
    expect(await sessionLine.innerText()).toContain('Write a file named notes.txt')
    expect(await panel.getByRole('button', { name: 'Allow all' }).isDisabled()).toBe(false)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached', timeout: 5_000 })

    // The sidebar strip answers without leaving the composer.
    const row = sessionRow(page)
    await row.locator('[class*="title"]').first().hover()
    const peek = page.locator('[data-approval-peek]')
    await peek.waitFor({ timeout: 10_000 })
    const peekText = await peek.innerText()
    expect(peekText).toContain(ACTION)
    // A plain write ask carries no unrestricted tier, so one click decides it.
    expect(peekText).not.toContain('Full access')
    // The card opens the payload the request will run, then settles it.
    await peek.getByRole('button', { name: 'Show raw payload' }).click()
    await peek.getByRole('button', { name: 'Allow', exact: true }).click()

    await settled
    await expect.poll(() => page.locator('[data-approval-key]').count(), { timeout: 20_000 }).toBe(0)
    await expect.poll(() => page.locator('[data-approval-pill]').count(), { timeout: 20_000 }).toBe(0)
    const written = await readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')
    expect(written).toContain(TOKENS.slice(0, 64))
    expect(tripwire.pageErrors).toEqual([])
  }, 240_000)
})
