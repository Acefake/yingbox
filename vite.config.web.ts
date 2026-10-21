import { resolve } from 'path'
import { type ProxyOptions, defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Standalone web / PWA build (no Electron main/preload). */

/** 同源代理:浏览器(手机)只访问 vite,由 vite 在 PC 本机回源,Amane 无需暴露局域网。 */
const amaneTarget = process.env.AMANE_PROXY_TARGET || 'http://127.0.0.1:18180'

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
  '/amane-api': {
    target: amaneTarget,
    changeOrigin: true,
    ws: true,
    rewrite: (path: string): string => path.replace(/^\/amane-api/, ''),
    // Amane 会把 token cookie 的 path 设为 /api;浏览器经代理的实际路径带 /amane-api 前缀,
    // 不改写则 cookie 永不回传,子资源(海报/剧照)全部 401。
    cookiePathRewrite: { '/api': '/amane-api/api' },
  },
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
  plugins: [vue()],
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
  },
})
