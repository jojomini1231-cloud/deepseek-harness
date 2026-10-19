// Keyless assembled-browser coverage for the Files workbench's git view: a real
// repository in the connected workspace, the real plugin graph, one Chromium.
//
// The repository is prepared before the workspace is picked, so the first git
// read the workbench makes already sees a `HEAD`, one modified file, and one
// untracked file. Everything asserted here is user-visible: the rail item that
// only a repository gets, the branch, the two groups and their folds, the
// per-kind color, the unified/split switch, the comparison that follows it, and
// the draggable splitter between the columns.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** The connected directory inside the scaffold's workspace; the repository lives here. */
const WORKSPACE_NAME = 'workspace'

/** Where this batch's accepted product forms are archived. */
const SHOT_DIR = fileURLToPath(new URL('../../../.artifacts/screenshots/1017-git-view', import.meta.url))

/** Run one git command in the prepared repository with a fixed identity and no signing. */
function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('web e2e: the working-tree git view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    // A repository with one commit, one modified file, and one untracked file.
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(cwd, 'keep.md'), 'unchanged\n')
    writeFileSync(join(cwd, 'change.md'), 'before\n')
    git(cwd, 'init', '-q', '-b', 'main')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'seed')
    writeFileSync(join(cwd, 'change.md'), 'after\n')
    writeFileSync(join(cwd, 'new.md'), 'added by the reader\n')
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  beforeEach(() => { onTestFailed(async () => { await saveFailureShot(page, `${SHOT_DIR}/git-view`) }) })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('lists the working tree and switches the comparison layout', async () => {
    const column = page.locator('[data-rightbar-col]')
    // The panel starts collapsed: its expand control opens it onto the guide.
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    const rail = column.locator('[data-files-rail]')
    await rail.waitFor({ timeout: 15_000 })
    // The rail only offers the git container because this workspace is a repository.
    const gitItem = rail.locator('[data-files-rail-item="git"]')
    await gitItem.waitFor({ timeout: 15_000 })
    await gitItem.click()
    const panel = column.locator('[data-files-git-panel]')
    await panel.waitFor({ timeout: 15_000 })
    // The branch and both groups come from the Host's status read.
    await expect.poll(async () => await column.locator('[data-files-git-branch]').textContent()).toBe('main')
    const groups = await column.locator('[data-files-git-group]').evaluateAll(nodes => nodes.map(node => (
      `${node.getAttribute('data-files-git-group')}:${node.querySelectorAll('[data-files-git-entry]').length}`)))
    expect(groups).toEqual(['changed:1', 'untracked:1'])
    // Each row states its kind, and the row color differs between the kinds.
    const kinds = await column.locator('[data-files-git-kind]').evaluateAll(nodes => nodes.map(node => (
      node.getAttribute('data-files-git-kind'))))
    expect(kinds).toEqual(['modified', 'untracked'])
    const colors = await column.locator('[data-files-git-kind]').evaluateAll(nodes => nodes.map(node => (
      getComputedStyle(node).color)))
    expect(colors[0]).not.toBe(colors[1])
    // The changed path's comparison starts unified and follows the layout choice.
    await column.locator('[data-files-git-entry="change.md"]').click()
    await column.locator('[data-review-view="unified"]').waitFor({ timeout: 15_000 })
    await column.locator('[data-files-git-diff-mode="split"]').click()
    await column.locator('[data-review-view="split"]').waitFor({ timeout: 15_000 })
    // Folding the changed group keeps its header and hides its rows.
    const changedToggle = column.locator('[data-files-git-group-toggle="changed"]')
    await changedToggle.click()
    await expect.poll(async () => await changedToggle.getAttribute('aria-expanded')).toBe('false')
    await expect.poll(async () => await column.locator('[data-files-git-entry="change.md"]').count()).toBe(0)
    await changedToggle.click()
    await expect.poll(async () => await column.locator('[data-files-git-entry="change.md"]').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('settles the two columns on a splitter drag', async () => {
    const column = page.locator('[data-rightbar-col]')
    const list = column.locator('[data-files-git-list]')
    const before = (await list.boundingBox())!
    const splitter = column.locator('[data-files-splitter]')
    const box = (await splitter.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    // Dragging toward the leading side gives the list more width.
    await expect.poll(async () => (await list.boundingBox())!.width).toBeGreaterThan(before.width + 20)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the changed-path top bar in place while the rows scroll', async () => {
    const column = page.locator('[data-rightbar-col]')
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    for (let index = 0; index < 40; index += 1) {
      writeFileSync(join(cwd, `many-${String(index).padStart(2, '0')}.md`), `file ${index}\n`)
    }
    const panel = column.locator('[data-files-git-panel]')
    await panel.waitFor({ timeout: 15_000 })
    await column.locator('[data-files-git-refresh]').click()
    // One modified path and the 41 untracked ones, more than the column shows.
    await expect.poll(async () => await column.locator('[data-files-git-entry]').count(), { timeout: 15_000 })
      .toBe(42)
    const header = column.locator('[data-files-git-header]')
    const list = column.locator('[data-files-git-list]')
    expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
    const panelBox = (await panel.boundingBox())!
    const before = (await header.boundingBox())!
    await list.evaluate((node) => { node.scrollTop = node.scrollHeight })
    await expect.poll(async () => await list.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    // The title, branch, and reload stay drawn at the column's top edge; the
    // rows move beneath them.
    const after = (await header.boundingBox())!
    expect(after.y).toBeCloseTo(before.y, 1)
    expect(after.y).toBeGreaterThanOrEqual(panelBox.y)
    expect(after.y + after.height).toBeLessThanOrEqual(panelBox.y + panelBox.height)
    expect(tripwire.pageErrors).toEqual([])
  })
})
