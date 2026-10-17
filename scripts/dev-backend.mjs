import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { killTree, reclaimPort } from './dev-port.mjs'

const backendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/services/backend'
)
const binName = process.platform === 'win32' ? 'main.exe' : 'main'
const binPath = path.join(backendDir, binName)

// 与 packages/services/backend/main.go 保持一致：BIND_ADDR 可覆盖默认监听地址
const bindAddr = (process.env.BIND_ADDR ?? '').trim() || '127.0.0.1:31471'
const port = Number(bindAddr.slice(bindAddr.lastIndexOf(':') + 1)) || 31471
// YINGBOX_DEV_RECLAIM_DRY=1 只检查端口占用并打印结果，不结束进程、不编译、不启动
const dryRun = process.env.YINGBOX_DEV_RECLAIM_DRY === '1'

// 启动前回收上次 dev 残留的后端，避免端口占用导致 bind 失败
const { reclaimed, blocked, released } = reclaimPort({
  port,
  binPath,
  dryRun,
  log: msg => console.log('[dev:backend]', msg),
})
if (blocked) {
  console.error(
    `[dev:backend] 端口 ${port} 被其它程序占用：PID ${blocked.pid}` +
      (blocked.image ? ` (${blocked.image})` : '') +
      '\n[dev:backend] 请先结束该进程，或用 BIND_ADDR=127.0.0.1:<其它端口> 启动'
  )
  process.exit(1)
}
if (dryRun) {
  console.log('[dev:backend] dry-run 结束：未编译、未启动')
  process.exit(0)
}
if (!released) {
  console.error(
    `[dev:backend] 端口 ${port} 仍被占用，启动中止（已回收 PID ${reclaimed.join(', ')}）`
  )
  process.exit(1)
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: backendDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error('killed by ' + signal))
      else resolve(code ?? 0)
    })
  })
}

const buildCode = await run('go', ['build', '-o', binPath, '.'])
if (buildCode !== 0) process.exit(buildCode)

const child = spawn(binPath, [], {
  cwd: backendDir,
  stdio: 'inherit',
  windowsHide: true,
  shell: false,
})

const childAlive = () => child.exitCode === null && child.signalCode === null

let stopping = false
const stop = () => {
  if (stopping || !childAlive() || !child.pid) return
  stopping = true
  // 同控制台的 Ctrl+C 会让后端自行优雅退出；超时仍未退出则连子进程一起强杀
  const timer = setTimeout(() => {
    if (childAlive() && child.pid) killTree(child.pid)
  }, 3000)
  timer.unref()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', () => {
  if (childAlive() && child.pid) killTree(child.pid)
})

child.on('error', err => {
  console.error('[dev:backend]', err)
  process.exit(1)
})
child.on('exit', code => process.exit(code ?? 0))
