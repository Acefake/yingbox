import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [vue()],
    // Prebundle CJS dayjs plugins so ESM named/default imports work in Vite
    optimizeDeps: {
      include: [
        'dayjs',
        'dayjs/plugin/advancedFormat',
        'dayjs/plugin/customParseFormat',
        'dayjs/plugin/localeData',
        'dayjs/plugin/weekday',
        'dayjs/plugin/weekOfYear',
        'dayjs/plugin/weekYear',
        'ant-design-vue',
        'vue',
        'vue-router',
        'pinia',
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: false,
      hmr: {
        host: '127.0.0.1',
        port: 3000,
      },
      watch: {
        usePolling: true,
      },
    },
  },
})
