import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@/api': resolve('src/renderer/src/api'),
        '@/components': resolve('src/renderer/src/components'),
        '@/assets': resolve('src/renderer/src/assets'),
        '@/views': resolve('src/renderer/src/views'),
        '@/utils': resolve('src/renderer/src/utils'),
        '@/constant': resolve('src/renderer/src/constant'),
        '@/hooks': resolve('src/renderer/src/hooks'),
        '@/types': resolve('src/renderer/src/types'),
      },
    },
    plugins: [vue()],
    server: {
      proxy: {
        '/api': {
          target: 'https://api.themoviedb.org/3',
          changeOrigin: true,
          secure: false,
          rewrite: path => path.replace(/^\/api/, ''),
        },
      },
    },
  },
})
