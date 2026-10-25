#!/usr/bin/env node
/**
 * 115 分区传输层自检启动器：用 vite 把 main.ts（含正式的 session-transport.ts）打包成 CJS，
 * 再用 Electron 启动它。用法：node scripts/pan115-selftest/run.mjs
 * - Electron 可执行文件默认取 node_modules/electron；ELECTRON_BIN 可指定别的。
 * - Linux 无 DISPLAY 时加 --ozone-platform=headless（不开窗口，只用主进程网络栈）。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(tmpdir(), 'yingbox-pan115-selftest')

await build({
  configFile: false,
  logLevel: 'warn',
  root: resolve(here, '../..'),
  build: {
    ssr: join(here, 'main.ts'),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: ['electron', /^node:/],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
})

const electron =
  process.env.ELECTRON_BIN || createRequire(import.meta.url)('electron')
const args = [join(outDir, 'main.cjs')]
if (process.platform === 'linux') {
  args.unshift('--no-sandbox')
  if (!process.env.DISPLAY) args.unshift('--ozone-platform=headless')
}
const run = spawnSync(electron, args, { encoding: 'utf8', timeout: 60_000 })
const line = `${run.stdout}`
  .split('\n')
  .find(l => l.startsWith('PAN115_SELFTEST '))
if (!line) {
  console.error(run.stdout, run.stderr, run.error ?? '')
  process.exit(1)
}
const result = JSON.parse(line.slice('PAN115_SELFTEST '.length))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
