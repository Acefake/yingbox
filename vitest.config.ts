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
  },
})
