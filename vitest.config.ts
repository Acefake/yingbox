import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 与 vite.config.web.ts 一致，渲染进程模块的单测可以直接 import '@/...'
    alias: { '@': resolve(__dirname, 'src/renderer/src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
