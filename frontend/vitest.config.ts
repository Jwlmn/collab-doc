import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // e2e/ 由 Playwright 运行，Vitest 只跑 src 下的单元测试
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // 覆盖率只度量 TS 纯模块（io/utils/stores/composables…）：
      // .vue 单文件组件 v8 解析不了（需额外接 vue 转换插件），
      // 视图层由 Playwright E2E 覆盖 —— 显式排除避免逐文件 parse 告警
      include: ['src/**'],
      exclude: ['src/**/__tests__/**', 'src/**/*.vue', '**/*.d.ts'],
      // CI 阈值（npm test -- --coverage 强制执行）：2026-09-30 基线
      // 63.32 stmts / 57.44 branch / 59.23 funcs / 64.62 lines，
      // 下浮 ~3-4 个点做地板 —— 防测试被删、防新增模块零测试裸奔；
      // 提覆盖率后可逐步上调
      thresholds: {
        statements: 60,
        branches: 54,
        functions: 55,
        lines: 60,
      },
    },
  },
})
