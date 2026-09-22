import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('双页面实时协同：A 输入 B 实时可见', async ({ context, page }) => {
  // A：注册并进入表格编辑器
  await registerRandomUser(page)
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('Excel 表格（电子表格）').click()
  await expect(page).toHaveURL(/\/sheet\/\d+/, { timeout: 15_000 })
  const docUrl = page.url()

  // B：同文档另开一页（共享登录态），等待连接
  const pageB = await context.newPage()
  await pageB.goto(docUrl)
  await expect(pageB.getByText('✓ 已同步')).toBeVisible({ timeout: 15_000 })

  // A 输入 → B 实时收到：
  // - bringToFront：开 B 后 A 已退到后台，Chromium 会对后台页 timer 节流，拖慢 focus
  // - 短暂等待模拟真人停顿，确保首键落在已 focus 的编辑框内
  await page.locator('.grid-wrap').click()
  await page.bringToFront()
  await page.waitForTimeout(150)
  await page.keyboard.type('REALTIME-FROM-A', { delay: 20 })
  await page.keyboard.press('Enter')

  await expect(
    pageB.locator('.sheet-grid tbody td').filter({ hasText: 'REALTIME-FROM-A' }),
  ).toHaveCount(1, { timeout: 10_000 })

  await pageB.close()
})
