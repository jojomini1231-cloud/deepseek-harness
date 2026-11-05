// Web e2e scenario: conversation retract and edit over one seeded two-turn
// session. The seed is the read-only shared recording owned by the
// navigation-panes scenario (its two prompts and tool-heavy turns give the
// retract action a turn worth removing); replay renders it purely from the
// log, so no model call participates.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot, WEB_FIXTURE_TIME } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/conversation-rewind', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/navigation-panes/session.v3.jsonl', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'conversation-rewind-web-e2e'
const TURN1_PREFIX = 'NavScenario: first run bash'
const TURN2_PREFIX = 'Reply in markdown with: a level-2 heading'
const EDIT_TEXT = 'Edited: summarize the navigation check in one sentence.'

describe.skipIf(MODE === 'record')('web e2e: retract and edit a conversation message', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID, undefined, { createdAt: WEB_FIXTURE_TIME })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.clock.setFixedTime(WEB_FIXTURE_TIME)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count() > 0) {
      await welcome.getByRole('button').click()
      await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    }
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText(TURN2_PREFIX, { exact: false }).first().waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('retracts a turn from the model history and opens the inline editor', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-rewind'))

    const before = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')

    // Retract the second turn: its prompt, tool cards and reply leave the
    // rendered timeline while the first turn stays.
    const turn2 = page.getByText(TURN2_PREFIX, { exact: false }).first()
    await turn2.scrollIntoViewIfNeeded()
    await turn2.hover()
    await page.getByRole('button', { name: 'Retract to this message', exact: true }).nth(1).click()
    await expect.poll(
      () => page.getByText(TURN2_PREFIX, { exact: false }).count(), { timeout: 15_000 },
    ).toBe(0)
    const retracted = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')

    // Edit the remaining first message: the bubble turns into the editor with
    // the recorded text and read-only chips, and cancel restores it.
    const turn1 = page.getByText(TURN1_PREFIX, { exact: false }).first()
    await turn1.hover()
    await page.getByRole('button', { name: 'Edit this message', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Edit message text' })
    await editor.waitFor({ timeout: 10_000 })
    await editor.fill(EDIT_TEXT)
    const editing = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await editor.press('Escape')
    await expect.poll(() => page.getByRole('textbox', { name: 'Edit message text' }).count()).toBe(0)
    await page.getByText(TURN1_PREFIX, { exact: false }).first().waitFor()

    await compareOrRefreshGolden(
      UI_EXPECTED,
      `## Before\n\n${before.trim()}\n\n## After retract\n\n${retracted.trim()}\n\n## Editing\n\n${editing.trim()}`,
      MODE,
    )
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
