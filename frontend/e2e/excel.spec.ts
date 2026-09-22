import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('新建 Excel 表格 → 单元格编辑 → 刷新持久', async ({ page }) => {
  await registerRandomUser(page)

  // 新建 ▾ → Excel 表格 → 表格编辑器
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('Excel 表格（电子表格）').click()
  await expect(page).toHaveURL(/\/sheet\/\d+/, { timeout: 15_000 })

  const grid = page.locator('.grid-wrap')
  await expect(grid).toBeVisible()
  // 「表格编辑区」是 aria-label，按属性定位
  await expect(page.locator('[aria-label="表格编辑区"]')).toBeVisible()

  // 键入编辑（真实键盘事件）：
  // - bringToFront 避免后台标签页 timer 节流拖慢 focus 渲染
  // - 短暂等待模拟真人「点完再打字」的自然停顿，让首键落在已 focus 的编辑框内
  await grid.click()
  await page.bringToFront()
  await page.waitForTimeout(150)
  await page.keyboard.type('XLSX-E2E-值', { delay: 20 })
  await page.keyboard.press('Enter')
  await expect(page.locator('.sheet-grid tbody td').filter({ hasText: 'XLSX-E2E-值' })).toHaveCount(1)

  // 刷新持久（协同服务 → document_states）
  await page.reload()
  await expect(page.locator('.sheet-grid tbody td').filter({ hasText: 'XLSX-E2E-值' })).toHaveCount(1, {
    timeout: 10_000,
  })
  await expect(page.getByText('✓ 已同步')).toBeVisible()
})
