import { resolve } from 'path'
import { type Plugin, type ProxyOptions, defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { compressStaticDir } from './scripts/compress-static'
import { vendorPlayerManualChunk } from './scripts/vendor-player-chunk'

/** Standalone web / PWA build (no Electron main/preload). */

/**
 * 独立片库服务（pnpm dev:server，src/server）：网页端的媒体库 API、事件流、海报与视频都走同源 /api、/media。
 * 去掉 Origin 头：浏览器的 Origin 是 vite 的地址，服务的跨站写保护按 Host 比对，经代理时两者必然不同。
 */
const libraryTarget =
  process.env.YINGBOX_SERVER_TARGET || 'http://127.0.0.1:31480'
const libraryProxy: ProxyOptions = {
  target: libraryTarget,
  changeOrigin: true,
  configure: proxy => {
    proxy.on('proxyReq', req => req.removeHeader('origin'))
  },
}

const localProxy = {
  '/api': libraryProxy,
  '/media': libraryProxy,
}

/** 网页产物写完后补 .br / .gz，独立服务按 Accept-Encoding 直接发。 */
function precompressStatic(): Plugin {
  let outDir = ''
  return {
    name: 'precompress-static',
    apply: 'build',
    configResolved(config): void {
      outDir = config.build.outDir
    },
    async closeBundle(): Promise<void> {
      if (!outDir) return
      const written = await compressStaticDir(outDir)
      console.log(`预压缩静态文件：${written.br} 个 .br，${written.gz} 个 .gz`)
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: resolve(__dirname, 'src/renderer/public'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [vue(), precompressStatic()],
  optimizeDeps: {
    include: ['vue', 'vue-router'],
  },
  server: {
    host: true,
    port: 4173,
    strictPort: false,
    proxy: localProxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy: localProxy,
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: vendorPlayerManualChunk,
      },
    },
  },
})
