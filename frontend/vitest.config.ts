import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // e2e/ 由 Playwright 运行，Vitest 只跑 src 下的单元测试
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
