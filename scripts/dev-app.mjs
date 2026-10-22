import { execSync, spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { missingDependencies } from './deps-check.mjs'

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
if (process.platform === 'win32') {
  process.env.NO_SANDBOX = '1'
  // 中文 Windows 控制台默认代码页 936（GBK），主进程和引擎打出的 UTF-8 日志会乱码；
  // 切到 65001（UTF-8），只影响当前控制台窗口，失败（不在控制台里）就算了。
  try {
    execSync('chcp 65001', { stdio: ['inherit', 'ignore', 'ignore'] })
  } catch {
    // 忽略
  }
}

// 拉了新代码没装依赖：先补装再启动（YINGBOX_SKIP_DEPS_CHECK=1 跳过）
if (!process.env.YINGBOX_SKIP_DEPS_CHECK) {
  const missing = missingDependencies(root)
  if (missing.length) {
    console.log(
      `[dev:app] 缺少依赖 ${missing.slice(0, 5).join('、')}${missing.length > 5 ? ` 等 ${missing.length} 个` : ''}，先运行 pnpm install`
    )
    const install = spawnSync('pnpm', ['install'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (install.status !== 0) {
      console.error('[dev:app] pnpm install 失败，请手动安装依赖后再启动')
      process.exit(install.status ?? 1)
    }
  }
}

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
