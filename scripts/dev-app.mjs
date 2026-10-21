import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(
  root,
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js'
)

// Windows 上 Electron 的进程沙箱会在初始化阶段直接退出
// （STATUS_BREAKPOINT 0x80000003，electron-vite 记成 2147483651），
// 连 electron --version 都到不了打印版本。electron-vite 看到
// NO_SANDBOX=1 后会给 Electron 加上 --no-sandbox。
if (process.platform === 'win32') process.env.NO_SANDBOX = '1'

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

child.on('error', err => {
  console.error('[dev:app]', err)
  process.exit(1)
})
child.on('exit', code => {
  process.exit(code ?? 1)
})
