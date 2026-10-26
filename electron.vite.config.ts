import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        // 第二个入口：媒体库引擎，跑在 utilityProcess（src/main/library/host.ts fork 它）；
        // 第三个入口：缩略图 WebP 编解码线程（src/main/thumbnails/index.ts 启动它）
        input: {
          index: resolve('src/main/index.ts'),
          'library-engine': resolve('src/main/library/engine/entry.ts'),
          'webp-worker': resolve('src/main/thumbnails/webp-worker.ts'),
          // 后台引擎（在线 / AV / 下载），src/main/engine fork 它
          engine: resolve('src/engine/index.ts'),
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
    // 主窗口（index.html）与独立播放器窗口（player.html）两个页面
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          player: resolve('src/renderer/player.html'),
        },
      },
    },
    optimizeDeps: {
      include: ['vue', 'vue-router'],
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
