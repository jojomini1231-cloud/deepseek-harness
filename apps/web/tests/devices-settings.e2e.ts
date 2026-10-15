/** The Device management page: the roster this deployment recorded, renamed and revoked over the wire. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/devices-settings', import.meta.url))

/**
 * Both rows are dated from live wall-clock state, and the page renders each
 * bucket as ordinary text rather than an aria label, so the capture tokenizes
 * the bucket the run happens to land in.
 */
const CAPTURE = { replacements: [['刚刚', '{{age}}']] as const }

it('renames and revokes a recorded browser, and reports a browser that revoked itself', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await openSettings(page, 'zh')
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.getByRole('button', { name: '设备管理', exact: true }).click()

  // Two exchanges reach the roster: the page's own navigation, and the Node
  // client the scaffold signs in with to hold a cookie for host-side calls.
  const rows = dialog.getByRole('listitem')
  await expect.poll(() => rows.count()).toBe(2)
  // Both were active moments ago, so the page dates neither of them; the row
  // names are what the page derives from each User-Agent.
  await expect.poll(() => rows.nth(0).innerText()).toContain('Chrome · Linux')
  await expect.poll(() => rows.nth(1).innerText()).toContain('浏览器 · 未知系统')
  expect(await rows.nth(1).innerText()).toContain('node')
  // Each row's controls name the device they act on, so a list of identical
  // buttons still says which browser it revokes.
  expect(await dialog.getByRole('button', { name: '重命名 Chrome · Linux', exact: true }).count()).toBe(1)
  expect(await dialog.getByRole('button', { name: '撤销 浏览器 · 未知系统', exact: true }).count()).toBe(1)

  await dialog.getByRole('button', { name: '重命名 浏览器 · 未知系统', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名该设备', exact: true })
  await rename.getByRole('textbox', { name: '设备名称', exact: true }).fill('构建机')
  await rename.getByRole('button', { name: '保存', exact: true }).click()
  await rename.waitFor({ state: 'detached' })
  // The row reports the roster's own answer rather than guessing at the write.
  await expect.poll(() => dialog.getByRole('button', { name: '撤销 构建机', exact: true }).count()).toBe(1)
  expect(await dialog.getByRole('button', { name: '重命名 浏览器 · 未知系统', exact: true }).count()).toBe(0)
  await compareOrRefreshGolden(join(EXPECTED, 'renamed.expected.md'),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd, CAPTURE), webSnapshotMode())

  // Revoking a device this browser is not using leaves the page signed in and
  // drops only that row.
  await dialog.getByRole('button', { name: '撤销 构建机', exact: true }).click()
  const revoke = page.getByRole('dialog', { name: '要撤销该设备吗？', exact: true })
  await expect.poll(() => revoke.innerText()).toContain('下一次请求时退出登录')
  await revoke.getByRole('button', { name: '确认撤销', exact: true }).click()
  await revoke.waitFor({ state: 'detached' })
  await expect.poll(() => rows.count()).toBe(1)
  expect(await rows.nth(0).innerText()).toContain('Chrome · Linux')

  // Revoking the browser reading the page is the one case the page cannot warn
  // about, because the device id travels in a cookie no script can read. The
  // revocation commits, the next read is refused, and the page says so instead
  // of offering a retry that could not succeed.
  await dialog.getByRole('button', { name: '撤销 Chrome · Linux', exact: true }).click()
  await revoke.getByRole('button', { name: '确认撤销', exact: true }).click()
  await revoke.waitFor({ state: 'detached' })
  const notice = dialog.getByRole('alert')
  await expect.poll(() => notice.innerText()).toContain('该浏览器已退出登录')
  expect(await notice.getByRole('button', { name: '重试', exact: true }).count()).toBe(0)
  await compareOrRefreshGolden(join(EXPECTED, 'self-revoked.expected.md'),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd, CAPTURE), webSnapshotMode())
})
