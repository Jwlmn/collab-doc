import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('生成公开只读链接 → 未登录访客可看不可改，且不被踢去登录', async ({ page, browser }) => {
  const shareContent = 'E2E 公开分享内容'

  await registerRandomUser(page)

  // 新建 MD 文档并写入内容（后面用访客视角核对可见）
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
  await page.locator('.ProseMirror').click()
  await page.keyboard.type(shareContent)
  await expect(page.locator('.ProseMirror')).toContainText(shareContent)
  // 内容先落到协作服务器，访客连上来才能看到
  await expect(page.getByText('✓ 已同步')).toBeVisible({ timeout: 15_000 })

  // 编辑器顶栏「共享」（仅所有者可见）→ 共享设置弹窗
  await page.getByRole('button', { name: '共享', exact: true }).click()
  await expect(page.locator('[aria-label="链接有效期"]')).toBeVisible()

  // 有效期选「1 天」（短有效期）→ 生成公开链接
  await page.locator('[aria-label="链接有效期"]').click()
  await page.locator('.n-base-select-option', { hasText: '1 天' }).click()
  const linkResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/share-link'),
  )
  await page.getByRole('button', { name: '生成链接' }).click()
  expect((await linkResponse).ok()).toBe(true)

  // 弹窗回显 /share/<token> 链接与有效期
  await expect(page.locator('[aria-label="公开分享链接"]')).toBeVisible()
  const shareUrl = await page.locator('[aria-label="公开分享链接"] input').inputValue()
  expect(shareUrl).toMatch(/\/share\/[\w.-]+$/)
  await expect(page.getByText('有效期至')).toBeVisible()
  const token = shareUrl.split('/share/')[1] as string

  // 全新浏览器上下文（无任何登录态）打开分享链接
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  const loginRequests: string[] = []
  guestPage.on('request', (request) => {
    if (request.url().includes('/login')) loginRequests.push(request.url())
  })

  const [metaResponse] = await Promise.all([
    guestPage.waitForResponse(
      (r) => r.url().includes(`/api/share/${token}`) && !r.url().includes('collab-token'),
    ),
    guestPage.goto(shareUrl),
  ])
  // 访客元数据接口 200（失效时是 404，未登录也不会 401）
  expect(metaResponse.status()).toBe(200)

  // 只读视图：访客横幅 + 内容可见 + 只读标识
  await expect(guestPage.getByText('只读访客链接')).toBeVisible()
  await expect(guestPage.getByText('有效期至')).toBeVisible()
  await expect(guestPage.locator('.ProseMirror')).toContainText(shareContent, { timeout: 15_000 })
  await expect(guestPage.locator('.n-tag', { hasText: '🔒 只读' })).toBeVisible()

  // 访客态（isShare）整体隐藏评论/版本入口
  await expect(guestPage.getByRole('button', { name: '评论' })).toHaveCount(0)
  await expect(guestPage.getByRole('button', { name: '版本历史' })).toHaveCount(0)

  // 编辑器不可写：contenteditable 关闭，敲键不进内容
  await expect(guestPage.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
  await guestPage.locator('.ProseMirror').click()
  await guestPage.keyboard.type('GUEST-HACK')
  await expect(guestPage.locator('.ProseMirror')).not.toContainText('GUEST-HACK')

  // 全程不跳登录：URL 仍是分享页，也没有任何 /login 请求
  await expect(guestPage).toHaveURL(new RegExp(`/share/${token}`))
  expect(loginRequests).toEqual([])

  await guestContext.close()
})
