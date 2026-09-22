import { defineConfig } from '@playwright/test'

/**
 * E2E 冒烟：需要整栈在跑（PostgreSQL/Redis 容器、Laravel :8000、HocusPocus :1234）。
 * 前端由 webServer 管理（本机已在跑则复用）。
 * 使用系统 Chrome（channel: chrome），免去 Playwright 浏览器下载（本机代理环境易 403）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
