import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('文档文件夹：建夹 → 移入 → 筛选 → 刷新徽标仍在 → 移出 → 空态', async ({ page }) => {
  const stamp = String(Date.now()).slice(-6)
  const titleA = `E2E文件夹A${stamp}`
  const titleB = `E2E文件夹B${stamp}`
  const folderName = `E2E夹${stamp}`

  await registerRandomUser(page)

  // 新建两篇文档（B 后建，更新时间更晚排在前面）
  async function createDoc(title: string): Promise<void> {
    await page.getByRole('button', { name: /新建/ }).click()
    await page.getByText('MD 文档（富文本）').click()
    await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
    const renamed = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/api\/documents\/\d+$/.test(r.url()),
    )
    const titleInput = page.getByPlaceholder('未命名文档')
    await expect(titleInput).toHaveValue('未命名文档')
    await titleInput.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(title)
    await page.keyboard.press('Enter')
    expect((await renamed).ok()).toBe(true)
    await page.getByRole('button', { name: '返回文档列表' }).click()
    await expect(page).toHaveURL(/\/$/)
  }

  await createDoc(titleA)
  await createDoc(titleB)

  // 打开管理弹窗建夹（GET /folders 挂载时已发过，必须按 method 精确等待 POST）
  await page.getByRole('button', { name: '管理文件夹' }).click()
  await expect(page.getByText('管理文件夹', { exact: true })).toBeVisible()
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/folders$/.test(r.url()),
  )
  await page.getByPlaceholder('新文件夹名称').fill(folderName)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  expect((await created).ok()).toBe(true)
  await expect(page.locator('.folder-manage-row').filter({ hasText: folderName })).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByText('管理文件夹', { exact: true })).toBeHidden()

  // 移动 A 入夹
  const rowA = page.locator('.doc-list .n-list-item').filter({ hasText: titleA })
  const attached = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/documents\/\d+\/folder$/.test(r.url()),
  )
  await rowA.getByRole('button', { name: '移动' }).click()
  await page.locator('.n-dropdown-menu').getByText(folderName, { exact: true }).click()
  expect((await attached).ok()).toBe(true)
  await expect(rowA.locator('.n-tag').filter({ hasText: folderName })).toBeVisible()

  // 筛选：选中文件夹后只剩 A；回「全部」恢复
  const filterSelect = page.getByLabel('按文件夹筛选')
  await filterSelect.click()
  await page.locator('.n-select-menu').getByText(folderName, { exact: true }).click()
  await expect(page.locator('.doc-list .n-list-item')).toHaveCount(1)
  await expect(page.locator('.doc-list .n-list-item').filter({ hasText: titleA })).toHaveCount(1)
  await filterSelect.click()
  await page.locator('.n-select-menu').getByText('全部文件夹').click()
  await expect(page.locator('.doc-list .n-list-item')).toHaveCount(2)

  // 刷新：筛选重置为全部（会话内），但徽标从服务端恢复——端到端验证后端视角关系修复
  await page.reload()
  await expect(page.locator('.doc-list .n-list-item')).toHaveCount(2, { timeout: 15_000 })
  await expect(
    page.locator('.doc-list .n-list-item').filter({ hasText: titleA }).locator('.n-tag').filter({ hasText: folderName }),
  ).toBeVisible()

  // 移出：徽标消失 → 按文件夹筛选为空态
  const rowA2 = page.locator('.doc-list .n-list-item').filter({ hasText: titleA })
  const detached = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/documents\/\d+\/folder$/.test(r.url()),
  )
  await rowA2.getByRole('button', { name: '移动' }).click()
  await page.locator('.n-dropdown-menu').getByText('未分类', { exact: true }).click()
  expect((await detached).ok()).toBe(true)
  await expect(rowA2.locator('.n-tag').filter({ hasText: folderName })).toHaveCount(0)

  await filterSelect.click()
  await page.locator('.n-select-menu').getByText(folderName, { exact: true }).click()
  await expect(page.getByText('此文件夹还没有文档')).toBeVisible()
})

test('文件夹管理：重命名与删除（激活筛选被重置回全部）', async ({ page }) => {
  const stamp = String(Date.now()).slice(-6)
  const folderName = `E2E管理夹${stamp}`
  const renamedName = `E2E改名夹${stamp}`

  await registerRandomUser(page)

  // 建夹
  await page.getByRole('button', { name: '管理文件夹' }).click()
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/folders$/.test(r.url()),
  )
  await page.getByPlaceholder('新文件夹名称').fill(folderName)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  expect((await created).ok()).toBe(true)

  // 行内重命名（进入编辑态后名字在 input value 里，hasText 匹配不到 → 按含 input 定位）
  const row = page.locator('.folder-manage-row').filter({ hasText: folderName })
  await row.getByRole('button', { name: '重命名' }).click()
  const editRow = page.locator('.folder-manage-row').filter({ has: page.locator('input') })
  const renamed = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/folders\/\d+$/.test(r.url()),
  )
  await editRow.locator('input').fill(renamedName)
  await editRow.getByRole('button', { name: '保存' }).click()
  expect((await renamed).ok()).toBe(true)
  await expect(
    page.locator('.folder-manage-row').filter({ hasText: renamedName }),
  ).toBeVisible()

  // 关闭弹窗，筛选选中该夹（此时无文档 → 空态）
  await page.getByRole('button', { name: '关闭' }).click()
  const filterSelect = page.getByLabel('按文件夹筛选')
  await filterSelect.click()
  await page.locator('.n-select-menu').getByText(renamedName, { exact: true }).click()
  await expect(page.getByText('此文件夹还没有文档')).toBeVisible()

  // 删除：dialog 确认 → DELETE → 激活筛选重置回「全部文件夹」
  await page.getByRole('button', { name: '管理文件夹' }).click()
  const row2 = page.locator('.folder-manage-row').filter({ hasText: renamedName })
  await row2.getByRole('button', { name: '删除', exact: true }).click()
  const deleted = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && /\/api\/folders\/\d+$/.test(r.url()),
  )
  // 管理弹窗（n-modal preset=dialog）与确认框同带 .n-dialog 类 → 按确认文案过滤
  await page
    .locator('.n-dialog')
    .filter({ hasText: '确定删除文件夹' })
    .getByRole('button', { name: '删除', exact: true })
    .click()
  expect((await deleted).ok()).toBe(true)
  await expect(page.locator('.folder-manage-row')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭' }).click()

  // 被删文件夹是激活筛选 → 已重置为全部（且回到通用空态，而非「此文件夹还没有文档」）
  await expect(filterSelect).toHaveText('全部文件夹')
  await expect(page.getByText('此文件夹还没有文档')).toHaveCount(0)
})
