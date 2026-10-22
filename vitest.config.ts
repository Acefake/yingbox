import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 让单测能 import .vue（ui 组件用 vue/server-renderer 渲染成字符串断言结构，不需要 DOM）
  plugins: [vue()],
  resolve: {
    // 与 vite.config.web.ts 一致，渲染进程模块的单测可以直接 import '@/...'
    alias: { '@': resolve(__dirname, 'src/renderer/src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 默认 5 秒在满载的 2 核机器上不够：cheerio 改为按需加载（#57）后，番号站点 / 演员 / 媒体库
    // 引擎的用例要在用例计时里付首次加载（单独跑 0.6 s → 1.1–1.5 s，满载时再翻几倍）
    testTimeout: 15_000,
  },
})
