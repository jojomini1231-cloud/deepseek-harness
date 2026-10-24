// Keyless assembled-browser coverage for the Files workbench's history view: a
// real repository in the connected workspace, the real plugin graph, one Chromium.
//
// The repository is prepared before the workspace is picked, so the first git
// read the workbench makes already sees a `HEAD` with a merge commit, a rename,
// a tag, a binary file, and more than one history page. Everything asserted here
// is user-visible: the rail item that only a repository gets, the rendered
// subject and hash hooks rather than hardcoded object ids, the commit page's
// message fold and changed-file chain, the unified/split comparison, the
// searchable refs filter that restarts the list without switching branches, the
// branch HEAD is attached to as the list's default scope, the next-page control,
// the uncommitted-changes row, the refresh gesture, the quiet self-refresh while
// the view is on screen, and the narrow drill-down a measured panel width picks.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import { HISTORY_PAGE_SIZE } from '@deepseek-ai/dsh-client-ui-sidebar-files/src/git.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, expectTooltipOnTop, newEnglishPage, saveFailureShot } from './support.ts'

/** The connected directory inside the scaffold's workspace; the repository lives here. */
const WORKSPACE_NAME = 'workspace'

/**
 * The commits the list draws before the fillers: the newest note, the merge,
 * the merged branch's own commit, and the main-side note. The baseline, the
 * rename, and the extension sit behind the fillers, so the second page holds
 * them.
 */
const LEADING_COMMITS = 4

/**
 * Filler commits that fill the first page exactly and leave a short second one.
 * One page is read per request, so the count follows the page size.
 */
const FILLER_COMMITS = HISTORY_PAGE_SIZE - LEADING_COMMITS

/** Commits one history page carries, as the client asks for them and the Host defaults them. */
const PAGE_SIZE = HISTORY_PAGE_SIZE

/** Run one git command in the prepared repository with a fixed identity and no signing. */
function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Stage every working-tree change and commit it. */
function commitAll(cwd: string, message: string, body?: string): void {
  git(cwd, 'add', '-A')
  if (body === undefined) git(cwd, 'commit', '-q', '-m', message)
  else git(cwd, 'commit', '-q', '-m', message, '-m', body)
}

/**
 * Build the repository while the workspace directory already exists but no
 * Session has read it yet.
 *
 * The history the renderer sees, newest first: a commit with a message body and
 * two changed files, the merge commit, the main-side commit, then filler commits,
 * then the merged branch's short history and the root commit with the binary file.
 * The working tree is left dirty for the list's uncommitted-changes row.
 * @param workspaceCwd - the scaffold's workspace root.
 * @returns the prepared repository directory.
 */
function prepareRepository(workspaceCwd: string): string {
  const cwd = join(workspaceCwd, WORKSPACE_NAME)
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(join(cwd, 'docs'), { recursive: true })
  mkdirSync(join(cwd, 'assets'), { recursive: true })
  writeFileSync(join(cwd, 'src/app.ts'), 'export const value = 1\n')
  writeFileSync(join(cwd, 'docs/notes.md'), '# Notes\n')
  writeFileSync(join(cwd, 'assets/blob.bin'), Buffer.from([0, 1, 2, 3, 255, 0, 7]))
  git(cwd, 'init', '-q', '-b', 'main')
  commitAll(cwd, 'seed: project baseline')
  // A rename the commit page lists under its new path.
  git(cwd, 'mv', 'src/app.ts', 'src/main.ts')
  appendFileSync(join(cwd, 'src/main.ts'), '// renamed\n')
  commitAll(cwd, 'refactor: rename app source')
  appendFileSync(join(cwd, 'src/main.ts'), 'export const extended = true\n')
  commitAll(cwd, 'feat: extend main module')
  git(cwd, 'tag', 'v1.0.0')
  // The merged branch commits one path before the fillers, so walking it shows
  // its short own history rather than the first page again; the merge commit
  // adds no other change, so its first-parent comparison holds exactly that path.
  git(cwd, 'checkout', '-q', '-b', 'topic/sidebar')
  writeFileSync(join(cwd, 'docs/sidebar.md'), '# Sidebar\n')
  commitAll(cwd, 'feat: add sidebar note')
  git(cwd, 'checkout', '-q', 'main')
  // The first page holds 50 commits; 46 fillers put every interesting commit on
  // page one and leave a short second page for the load-more assertion.
  for (let index = 1; index <= FILLER_COMMITS; index += 1) {
    appendFileSync(join(cwd, 'journal.md'), `tick ${index}\n`)
    commitAll(cwd, `chore: tick ${String(index).padStart(2, '0')}`)
  }
  writeFileSync(join(cwd, 'docs/main-note.md'), '# Main note\n')
  commitAll(cwd, 'feat: add main note')
  git(cwd, 'merge', '-q', '--no-ff', 'topic/sidebar', '-m', 'merge: topic/sidebar into main')
  // The newest commit carries a body (the message fold) and two changed files
  // (the summary count); its comparison opens on the commit's source file.
  appendFileSync(join(cwd, 'src/main.ts'), 'export const finished = true\n')
  appendFileSync(join(cwd, 'docs/notes.md'), '## History\n')
  commitAll(cwd, 'docs: finish history notes', 'The footer now names the fixture day.')
  // A dirty working tree gives the list its uncommitted-changes row.
  appendFileSync(join(cwd, 'docs/main-note.md'), 'dirty line\n')
  writeFileSync(join(cwd, 'untracked.md'), 'untracked\n')
  return cwd
}

/**
 * Drag the frame's right-panel resize handle; a positive `dx` narrows the panel
 * because the handle sits on its leading edge.
 * @param page - the page under test.
 * @param dx - horizontal pointer distance, positive toward the frame's trailing edge.
 */
async function dragRightbar(page: Page, dx: number): Promise<void> {
  const handle = page.locator('[data-side="rightbar"]')
  const box = (await handle.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  try {
    await page.mouse.move(center.x + dx, center.y, { steps: 8 })
  } finally {
    await page.mouse.up()
  }
}

/**
 * Open the Files workbench on its history container.
 *
 * Every case that reads the history view starts here rather than relying on a
 * previous case having opened it, so a single `-t` run sees the same page.
 * @param page - the page under test.
 * @returns the right column holding the workbench.
 */
async function openHistoryView(page: Page) {
  const column = page.locator('[data-rightbar-col]')
  if (await column.locator('[data-files-history]').count() === 0) {
    // The panel starts collapsed: its expand control opens it onto the guide.
    if (await page.locator('[data-sidebar-right-expand]').count() > 0) await page.locator('[data-sidebar-right-expand]').click()
    const guideEntry = column.locator('[data-sidebar-right-guide-entry="files"]')
    if (await guideEntry.count() > 0) await guideEntry.click()
    const rail = column.locator('[data-files-rail]')
    await rail.waitFor({ timeout: 15_000 })
    // The rail offers the git containers only because this workspace is a repository.
    await rail.locator('[data-files-rail-item="git"]').waitFor({ timeout: 15_000 })
    const historyItem = rail.locator('[data-files-rail-item="history"]')
    await historyItem.waitFor({ timeout: 15_000 })
    await historyItem.click()
    await column.locator('[data-files-history]').waitFor({ timeout: 15_000 })
  }
  return column
}

describe('web e2e: the repository history view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let repo: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    repo = prepareRepository(scaffold.workspaceCwd)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  beforeEach(() => { onTestFailed(async () => { await saveFailureShot(page, 'web-e2e-git-history') }) })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('opens the history view and walks the commit page, refs filter, and refresh', async () => {
    const column = await openHistoryView(page)
    const panel = column.locator('[data-files-history]')
    // The panel measures wide enough for two columns.
    await expect.poll(async () => await panel.getAttribute('data-files-history-layout'), { timeout: 15_000 }).toBe('wide')
    // The Host answered the first page of the attached branch: 50 rows and a
    // next-page control. The chip names that branch, not all refs.
    const rows = column.locator('[data-files-history-commit]')
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBe(PAGE_SIZE)
    const chip = column.locator('[data-files-history-refs]')
    await expect.poll(async () => await chip.textContent(), { timeout: 15_000 }).toBe('main')
    expect(await column.locator('[data-files-history-load]').count()).toBe(1)
    // The attached branch starts at HEAD, so the dirty working tree is the
    // list's first row under the default scope.
    await expect.poll(async () => await column.locator('[data-files-history-dirty]').count(), { timeout: 15_000 }).toBe(1)
    // The newest commit opens on its own: the row is current and the page names
    // the same subject and abbreviated hash, both read from the rendered hooks.
    const firstRow = rows.first()
    const firstHash = await firstRow.getAttribute('data-files-history-commit')
    expect(firstHash).toMatch(/^[0-9a-f]{40,64}$/u)
    const firstSubject = (await firstRow.locator('[data-files-history-subject]').textContent())!
    expect(firstSubject).toBe('docs: finish history notes')
    const firstShort = (await firstRow.locator('[data-files-history-commit-hash]').textContent())!
    await expect.poll(async () => await firstRow.getAttribute('aria-current'), { timeout: 15_000 }).toBe('true')
    await expect.poll(async () => await column.locator('[data-files-history-page-subject]').textContent(), { timeout: 15_000 })
      .toBe(firstSubject)
    await expect.poll(async () => await column.locator('[data-files-history-page-hash]').textContent(), { timeout: 15_000 })
      .toBe(firstShort)
    // The message body folds from the page.
    const messageToggle = column.locator('[data-files-history-message-toggle]')
    await expect.poll(async () => await messageToggle.count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => await messageToggle.getAttribute('aria-expanded')).toBe('false')
    expect(await column.locator('[data-files-history-page-message]').count()).toBe(0)
    await messageToggle.click()
    await expect.poll(async () => await column.locator('[data-files-history-page-message]').textContent()).toContain('fixture day')
    await messageToggle.click()
    await expect.poll(async () => await column.locator('[data-files-history-page-message]').count()).toBe(0)
    // The changed-file section states the complete count and lists both paths;
    // the comparison opens on the commit's source file, unified.
    await expect.poll(async () => await column.locator('[data-files-history-summary]').textContent(), { timeout: 15_000 })
      .toContain('2 files')
    const files = column.locator('[data-files-history-file]')
    await expect.poll(async () => await files.count(), { timeout: 15_000 }).toBe(2)
    expect(await files.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-files-history-file'))))
      .toEqual(['docs/notes.md', 'src/main.ts'])
    await expect.poll(async () => await column.locator('[data-files-history-diff]').getAttribute('data-files-history-diff'), { timeout: 15_000 })
      .toBe('src/main.ts')
    await column.locator('[data-review-view="unified"]').waitFor({ timeout: 15_000 })
    // The layout choice is honoured and stays chosen across commit picks; the
    // icon-only toggle carries the shown layout and marks the split choice.
    await column.locator('[data-files-history-diff-mode="unified"]').click()
    await column.locator('[data-review-view="split"]').waitFor({ timeout: 15_000 })
    const layoutToggle = column.locator('[data-files-history-diff-mode="split"]')
    await layoutToggle.waitFor({ timeout: 15_000 })
    expect(await layoutToggle.getAttribute('aria-pressed')).toBe('true')
    // The commit page's comparison shows the changed hunks by default, and its
    // shared scope toggle names the scope its next press switches to.
    const scopeToggle = column.locator('[data-files-history-diff-scope="changes"]')
    await scopeToggle.waitFor({ timeout: 15_000 })
    expect(await scopeToggle.getAttribute('aria-pressed')).toBe('false')
    await page.mouse.move(10, 500)
    await scopeToggle.hover()
    const scopeTooltip = column.getByRole('tooltip', { name: 'Switch to full file', exact: true })
    await scopeTooltip.waitFor()
    await expectTooltipOnTop(scopeTooltip)
    await scopeToggle.click()
    const widenedScope = column.locator('[data-files-history-diff-scope="complete"]')
    await widenedScope.waitFor({ timeout: 15_000 })
    expect(await widenedScope.getAttribute('aria-pressed')).toBe('true')
    // The scope choice is independent of the layout choice; restore the default.
    await widenedScope.click()
    await column.locator('[data-files-history-diff-scope="changes"]').waitFor({ timeout: 15_000 })
    // Another row moves the page: the merge commit's first-parent comparison
    // holds only the branch-side path.
    const mergeRow = rows.filter({ hasText: 'merge: topic/sidebar into main' })
    // The graph gutter draws the merge's fork: the merge row carries a diagonal
    // lane segment beside the mainline it continues.
    const mergeSegments = await mergeRow.locator('svg line').evaluateAll(lines => lines.map(line => ({
      x1: line.getAttribute('x1'), x2: line.getAttribute('x2'),
    })))
    expect(mergeSegments.length).toBeGreaterThan(0)
    expect(mergeSegments.some(segment => segment.x1 !== segment.x2)).toBe(true)
    await mergeRow.scrollIntoViewIfNeeded()
    await mergeRow.click()
    await expect.poll(async () => await column.locator('[data-files-history-page-subject]').textContent(), { timeout: 15_000 })
      .toBe('merge: topic/sidebar into main')
    await expect.poll(async () => await column.locator('[data-files-history-file]').count(), { timeout: 15_000 }).toBe(1)
    expect(await column.locator('[data-files-history-file]').getAttribute('data-files-history-file')).toBe('docs/sidebar.md')
    await expect.poll(async () => await column.locator('[data-files-history-diff]').getAttribute('data-files-history-diff'), { timeout: 15_000 })
      .toBe('docs/sidebar.md')
    await column.locator('[data-review-view="split"]').waitFor({ timeout: 15_000 })
    // The refs filter searches the local branches and tags, then walks one
    // branch's history; picking it restarts the list without switching branches.
    await chip.click()
    const search = page.locator('[data-files-history-refs-search]')
    await search.waitFor({ timeout: 15_000 })
    const refRows = page.locator('[data-files-history-ref]')
    await expect.poll(async () => await refRows.count(), { timeout: 15_000 }).toBe(4)
    await search.fill('topic')
    await expect.poll(async () => await refRows.count()).toBe(2)
    expect(await page.locator('[data-files-history-ref="main"]').count()).toBe(0)
    expect(await page.locator('[data-files-history-ref="v1.0.0"]').count()).toBe(0)
    await page.locator('[data-files-history-ref="topic/sidebar"]').click()
    await expect.poll(async () => await chip.textContent(), { timeout: 15_000 }).toBe('topic/sidebar')
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBe(4)
    await expect.poll(async () => await column.locator('[data-files-history-page-subject]').textContent(), { timeout: 15_000 })
      .toBe('feat: add sidebar note')
    expect(await column.locator('[data-files-history-load]').count()).toBe(0)
    // "All refs" walks HEAD again, and the restored first page keeps the control.
    await chip.click()
    await page.locator('[data-files-history-ref=":all"]').click()
    await expect.poll(async () => await chip.textContent(), { timeout: 15_000 }).toBe('All refs')
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBe(PAGE_SIZE)
    expect(await column.locator('[data-files-history-load]').count()).toBe(1)
    // The dirty working tree is the list's first row.
    const dirty = column.locator('[data-files-history-dirty]')
    await dirty.waitFor({ timeout: 15_000 })
    await expect.poll(async () => await dirty.textContent()).toContain('2 files')
    // Refresh re-reads the refs and the first page: a commit made after the tab
    // opened appears at the top without any polling of its own.
    writeFileSync(join(repo, 'refresh.md'), 'refresh\n')
    commitAll(repo, 'chore: prove refresh')
    await column.locator('[data-files-history-refresh]').click()
    await expect.poll(async () => await rows.first().locator('[data-files-history-subject]').textContent(), { timeout: 15_000 })
      .toBe('chore: prove refresh')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('appends the next history page and draws a root commit with a binary file', async () => {
    const column = await openHistoryView(page)
    const rows = column.locator('[data-files-history-commit]')
    // The repository decides the total, so this case never encodes a commit
    // another case made.
    const total = Number(git(repo, 'rev-list', '--count', 'HEAD').trim())
    expect(total).toBeGreaterThan(PAGE_SIZE)
    const load = column.locator('[data-files-history-load]')
    await load.click()
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBe(total)
    // The walked ref has no commits after the loaded pages, so the control goes.
    expect(await load.count()).toBe(0)
    // The root commit is the last row: its page adds the whole tree, including
    // the binary file, and compares against the empty tree.
    const rootRow = rows.filter({ hasText: 'seed: project baseline' })
    await rootRow.scrollIntoViewIfNeeded()
    await rootRow.click()
    await expect.poll(async () => await column.locator('[data-files-history-page-subject]').textContent(), { timeout: 15_000 })
      .toBe('seed: project baseline')
    await expect.poll(async () => await column.locator('[data-files-history-file]').count(), { timeout: 15_000 }).toBe(3)
    await expect.poll(async () => await column.locator('[data-files-history-diff]').getAttribute('data-files-history-diff'), { timeout: 15_000 })
      .toBe('src/app.ts')
    const binaryRow = column.locator('[data-files-history-file="assets/blob.bin"]')
    await expect.poll(async () => await binaryRow.textContent()).toContain('Binary')
    await binaryRow.click()
    await column.locator('[data-files-history-diff-state="binary"]').waitFor({ timeout: 15_000 })
    expect(await column.locator('[data-files-history-diff]').getAttribute('data-files-history-diff')).toBe('assets/blob.bin')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('refreshes itself while the view is on screen', async () => {
    const column = await openHistoryView(page)
    const rows = column.locator('[data-files-history-commit]')
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBeGreaterThan(0)
    // A working tree that becomes dirty appears as the list's first row without
    // a gesture, and clears again once the change is committed.
    appendFileSync(join(repo, 'docs/main-note.md'), 'auto refresh\n')
    const dirty = column.locator('[data-files-history-dirty]')
    await dirty.waitFor({ timeout: 15_000 })
    // A commit made outside the app is prepended above the loaded rows, so the
    // reader's page and rows stay put and nothing blanks out.
    writeFileSync(join(repo, 'auto-refresh.md'), 'auto refresh\n')
    commitAll(repo, 'chore: prove auto refresh')
    await expect.poll(async () => await rows.first().locator('[data-files-history-subject]').textContent(), { timeout: 15_000 })
      .toBe('chore: prove auto refresh')
    await expect.poll(async () => await dirty.count(), { timeout: 15_000 }).toBe(0)
    expect(await column.locator('[data-files-history-state="loading"]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('drops to the measured narrow drill-down when the panel narrows', async () => {
    const column = await openHistoryView(page)
    const panel = column.locator('[data-files-history]')
    const wide = (await panel.boundingBox())!
    // The rendered layout is the assertion; the width only states the panel is
    // comfortably above any narrow threshold, not what that threshold is.
    expect(wide.width).toBeGreaterThan(600)
    await dragRightbar(page, 260)
    await expect.poll(async () => await panel.getAttribute('data-files-history-layout'), { timeout: 15_000 }).toBe('narrow')
    // One column, on the list: narrowing opens no drill-down, so the commit the
    // wide layout selected does not become a page the reader never picked.
    expect(await column.locator('[data-files-splitter]').count()).toBe(0)
    expect(await panel.getAttribute('data-files-history-page-open')).toBe('false')
    await column.locator('[data-files-history-list]').waitFor({ timeout: 15_000 })
    // A row opens the commit page, and back returns to the list.
    const firstRow = column.locator('[data-files-history-commit]').first()
    const firstSubject = (await firstRow.locator('[data-files-history-subject]').textContent())!
    await firstRow.click()
    await expect.poll(async () => await panel.getAttribute('data-files-history-page-open')).toBe('true')
    await expect.poll(async () => await column.locator('[data-files-history-page-subject]').textContent(), { timeout: 15_000 })
      .toBe(firstSubject)
    await column.locator('[data-files-history-back]').click()
    await expect.poll(async () => await panel.getAttribute('data-files-history-page-open')).toBe('false')
    await column.locator('[data-files-history-list]').waitFor({ timeout: 15_000 })
    expect(await column.locator('[data-files-history-page]').count()).toBe(0)
    // Widening the panel restores the two-pane layout.
    await dragRightbar(page, -260)
    await expect.poll(async () => await panel.getAttribute('data-files-history-layout'), { timeout: 15_000 }).toBe('wide')
    // The divider is a zero-width hit target, so it is attached rather than visible.
    await expect.poll(async () => await column.locator('[data-files-splitter]').count(), { timeout: 15_000 }).toBe(1)
    await column.locator('[data-files-history-page]').waitFor({ timeout: 15_000 })
    await column.locator('[data-files-history-list]').waitFor({ timeout: 15_000 })
    expect(await column.locator('[data-files-history-back]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
