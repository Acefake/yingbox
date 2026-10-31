import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import pkg from './package.json'
import { nasBuildGuard } from './scripts/nas-build-guard'

/**
 * 独立片库服务的构建（pnpm build:server）：Node 22 目标、CommonJS 产物，`node out/server/server.js` 直接运行。
 *
 * - 入口：server（HTTP 服务）、webp-worker（图片编解码线程，和服务同目录，见 src/server/app.ts）
 *   与 engine（在线引擎子进程，见 src/server/online/engine.ts）；
 * - 依赖不打包（cheerio、@jsquash/* 等从 node_modules 加载；wasm 文件按包路径读取），
 *   部署时 `pnpm install --prod` 即可，不需要 Electron。
 */
const external = [
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
  ...Object.keys(pkg.dependencies),
]

export default defineConfig(({ mode }) => ({
  plugins:
    mode === 'nas'
      ? [
          nasBuildGuard('server'),
          {
            name: 'nas-server-features',
            enforce: 'pre',
            resolveId(source, importer) {
              if (
                source === './features' &&
                importer?.replaceAll('\\', '/').endsWith('/src/server/app.ts')
              )
                return resolve(__dirname, 'src/server/nas/features.ts')
            },
          },
        ]
      : [],
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(__dirname, mode === 'nas' ? 'out/nas' : 'out/server'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        server: resolve(__dirname, 'src/server/index.ts'),
        'webp-worker': resolve(__dirname, 'src/main/thumbnails/webp-worker.ts'),
        engine: resolve(__dirname, 'src/engine/node.ts'),
      },
      external: id =>
        external.some(name => id === name || id.startsWith(`${name}/`)),
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  ssr: { target: 'node' },
}))
