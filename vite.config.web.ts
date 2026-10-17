import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Standalone web / PWA build (no Electron main/preload). */

/** 同源代理:浏览器(手机)只访问 vite,由 vite 在 PC 本机回源,后端无需暴露局域网。 */
const backendTarget = process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:31471'
const amaneTarget = process.env.AMANE_PROXY_TARGET || 'http://127.0.0.1:18180'
const localProxy = {
  '/backend-api': {
    target: backendTarget,
    changeOrigin: true,
    ws: true,
    rewrite: (path: string): string => path.replace(/^\/backend-api/, ''),
  },
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
    include: ['ant-design-vue', 'vue', 'vue-router', 'pinia'],
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
