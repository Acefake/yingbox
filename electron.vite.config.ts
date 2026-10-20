import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        // 第二个入口：媒体库引擎，跑在 utilityProcess（src/main/library/host.ts fork 它）
        input: {
          index: resolve('src/main/index.ts'),
          'library-engine': resolve('src/main/library/engine/entry.ts'),
        },
      },
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
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      // 必须锁死：渲染层的 localStorage 按 origin 分桶，端口一旦漂移到 3001，
      // 用户的主题/播放器/数据源等设置会整体“归零”（旧值还躺在 3000 那个桶里）。
      strictPort: true,
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
