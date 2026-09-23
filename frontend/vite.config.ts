import vue from '@vitejs/plugin-vue'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [NaiveUiResolver()] }),
    AutoImport({ resolvers: [NaiveUiResolver()] }),
  ],
  server: {
    // 监听所有网卡：本机 localhost + 局域网 IP 均可访问
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/sanctum': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 编辑器 + 协同依赖体积较大，按需分包后单 chunk 超 500KB 属预期
    chunkSizeWarningLimit: 1000,
  },
})
