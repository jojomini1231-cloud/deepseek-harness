/** Phone navigation, responsive focus, and touch steering geometry through the Web profile. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, pinBrowserClock, pinHostClock, saveFailureShot } from './support.ts'

const picker = fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url))

it('reveals phone navigation destinations and transfers focus across the phone breakpoint', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: picker })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    onTestFailed(() => saveFailureShot(page, 'mobile-shell-navigation'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(scaffold.authenticatedUrl)
    const frame = page.locator('[data-mobile-shell][data-mobile-drawer]')
    const leadingToggle = page.locator('[data-shell-leading] [data-sidebar-toggle]')
    const sidebarToggle = page.locator('[data-slot="sidebar"] [data-sidebar-toggle]')
    await leadingToggle.waitFor()
    await leadingToggle.click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await expect.poll(() => frame.getAttribute('data-mobile-drawer')).toBe('closed')
    await page.getByRole('heading', { name: 'Plugins', exact: true }).waitFor()

    // Selecting the already-visible destination is still a navigation commit.
    await leadingToggle.click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await expect.poll(() => frame.getAttribute('data-mobile-drawer')).toBe('closed')
    await leadingToggle.click()
    await page.locator('[data-slot="sidebar.workspaces"]')
      .getByRole('button', { name: 'New temporary session', exact: true }).click()
    await expect.poll(() => frame.getAttribute('data-mobile-drawer')).toBe('closed')
    await page.locator('[data-composer-input]').first().waitFor()

    await leadingToggle.focus()
    await page.setViewportSize({ width: 800, height: 844 })
    await expect.poll(() => sidebarToggle.evaluate(el => el === document.activeElement)).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => leadingToggle.evaluate(el => el === document.activeElement)).toBe(true)
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})

it('preserves the touch running-status slot when pending steering is admitted', async () => {
  const clock = pinHostClock()
  onTestFinished(() => { clock.mockRestore() })
  const scaffold = await launchWebScaffold({
    extraOverlayPath: picker,
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/steering/session.v3.jsonl', import.meta.url)),
    paceMs: 500,
    compareReplaySession: true,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, hasTouch: true,
      locale: 'en-US', timezoneId: 'Asia/Shanghai',
    })
    await pinBrowserClock(page)
    onTestFailed(() => saveFailureShot(page, 'mobile-shell-steering'))
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const requested = new Promise<void>((resolve) => {
      scaffold.ctx.on('session/event', (_session, event) => { if (event.type === 'request/context') resolve() })
    })
    const prompt = 'Use the ask_user_question tool to ask me exactly one question with id "checkpoint", question "Ready to continue?", header "Checkpoint", and options labeled "Yes" and "No". After I answer, reply with one short sentence acknowledging my answer and stop.'
    const steer = 'Interjection: include the word BANANA in your final reply.'
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled(30_000)
    await input.fill(prompt)
    await input.press('Enter')
    await requested
    await input.and(page.locator('[contenteditable="true"]')).waitFor()
    await input.fill(steer)
    await input.press('Enter')
    await page.getByRole('listitem').filter({ hasText: steer })
      .getByRole('button', { name: 'Steer queued message' }).click()
    await page.locator('[data-pending-steering]').filter({ hasText: steer }).waitFor()
    const question = page.locator('[data-question-key]')
    await question.waitFor()
    const reserved = await page.locator('[data-chat-running]').evaluate((row) => {
      return row.getBoundingClientRect().height + parseFloat(getComputedStyle(row).marginTop)
    })
    expect(reserved).toBe(60)
    await question.getByRole('radio', { name: 'Yes' }).click()
    await question.getByRole('radio', { name: 'Yes' }).press('Enter')
    await settled
    const admitted = page.locator('[data-chat-steering-batch="start"]').filter({ hasText: steer })
    await admitted.waitFor()
    await expect.poll(() => admitted.evaluate((el) => {
      const row = el.closest('[data-chat-flow-kind="steering"]')!
      return parseFloat(getComputedStyle(row).marginTop)
    })).toBe(reserved)
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
