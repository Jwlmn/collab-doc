import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('文档置顶 → 分区排序在前 → 刷新仍置顶 → 取消置顶复原', async ({ page }) => {
  const stamp = String(Date.now()).slice(-6)
  const titleA = `E2E置顶A${stamp}`
  const titleB = `E2E置顶B${stamp}`

  await registerRandomUser(page)

  // 新建两篇文档（后建的 B 更新时间更晚，默认排在 A 前面）
  async function createDoc(title: string): Promise<void> {
    await page.getByRole('button', { name: /新建/ }).click()
    await page.getByText('MD 文档（富文本）').click()
    await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
    const renamed = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/api\/documents\/\d+$/.test(r.url()),
    )
    // 先等 meta 落地（输入框拿到默认值），再全选改名：
    // ① 抢在 meta 前打字会被回填覆盖（产品侧已有焦点守卫，这里仍显式等值更稳）
    // ② 光标点进输入框是定位插入点，直接打字会追加到「未命名文档」后
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

  // 初始无分区：单列表，B 在前
  await expect(page.locator('.group-title')).toHaveCount(0)

  // 置顶较旧的 A
  const pinButton = page.getByRole('button', { name: `置顶 ${titleA}` })
  const pinned = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/documents\/\d+\/pin$/.test(r.url()),
  )
  await pinButton.click()
  expect((await pinned).ok()).toBe(true)

  // 分区出现：置顶组含 A，全部文档组含 B
  await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '全部文档' })).toBeVisible()
  const lists = page.locator('.doc-list')
  await expect(lists.nth(0).locator('.n-list-item').filter({ hasText: titleA })).toHaveCount(1)
  await expect(lists.nth(1).locator('.n-list-item').filter({ hasText: titleB })).toHaveCount(1)

  // 刷新后置顶状态从服务端恢复
  await page.reload()
  await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible({ timeout: 15_000 })
  await expect(
    page.locator('.doc-list').nth(0).locator('.n-list-item').filter({ hasText: titleA }),
  ).toHaveCount(1)

  // 取消置顶 → 分区消失，回到单列表
  await page.getByRole('button', { name: `取消置顶 ${titleA}` }).click()
  await expect(page.locator('.group-title')).toHaveCount(0)
  await expect(page.locator('.doc-list .n-list-item').filter({ hasText: titleA })).toHaveCount(1)
  await expect(page.locator('.doc-list .n-list-item').filter({ hasText: titleB })).toHaveCount(1)
})
