import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function toPid(value) {
  const pid = Number(String(value).trim())
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

function collectPids(output, into) {
  for (const token of String(output).split(/\s+/)) {
    const pid = toPid(token)
    if (pid) into.add(pid)
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 查询监听指定端口的进程 PID。
 * Windows 优先 Get-NetTCPConnection，回退 netstat；其它平台用 lsof。
 */
export function listenersOnPort(target) {
  const pids = new Set()
  try {
    if (process.platform === 'win32') {
      try {
        const out = execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-NetTCPConnection -LocalPort ${target} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
          ],
          { encoding: 'utf8', windowsHide: true }
        )
        collectPids(out, pids)
      } catch {
        // PowerShell 不可用时回退 netstat
      }
      if (pids.size === 0) {
        const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
          encoding: 'utf8',
          windowsHide: true,
        })
        for (const line of out.split(/\r?\n/)) {
          const cells = line.trim().split(/\s+/)
          if (
            cells.length >= 5 &&
            cells[0].toUpperCase() === 'TCP' &&
            cells[3] === 'LISTENING' &&
            cells[1].endsWith(`:${target}`)
          ) {
            const pid = toPid(cells[cells.length - 1])
            if (pid) pids.add(pid)
          }
        }
      }
    } else {
      collectPids(
        execFileSync('lsof', ['-ti', `tcp:${target}`, '-sTCP:LISTEN'], {
          encoding: 'utf8',
        }),
        pids
      )
    }
  } catch {
    // 端口空闲或查询工具不可用
  }
  return [...pids]
}

/**
 * 进程的可执行文件路径，取不到返回空串。
 * Windows 上让 PowerShell 返回 Base64：中文路径经控制台代码页会变成乱码，
 * Base64 是纯 ASCII，不受代码页影响。
 */
export function imagePathOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = (Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path; ` +
            'if ($p) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p)) }',
        ],
        { encoding: 'utf8', windowsHide: true }
      ).trim()
      if (!/^[A-Za-z0-9+/=]+$/.test(out)) return ''
      return Buffer.from(out, 'base64').toString('utf8').trim()
    }
    if (process.platform === 'linux') {
      return fs.readlinkSync(`/proc/${pid}/exe`).trim()
    }
    const out = execFileSync(
      'lsof',
      ['-p', String(pid), '-a', '-d', 'txt', '-Fn'],
      {
        encoding: 'utf8',
      }
    )
    const line = out.split(/\r?\n/).find(entry => entry.startsWith('n'))
    if (line) return line.slice(1).trim()
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

/** 结束进程；Windows 需连子进程一起收（与 src/main/backend-manager.ts 的退出逻辑一致） */
export function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch {
    // 进程可能已自行退出
  }
}

export function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

/** 按可执行文件路径判断是否为本次 dev 编译出的后端 */
export function isOurBackend(image, binPath) {
  if (!image) return false
  if (samePath(image, binPath)) return true
  // Unix 的 ps 只能拿到可执行文件名，退化为按文件名比较
  if (process.platform === 'win32') return false
  return (
    path.basename(image).toLowerCase() === path.basename(binPath).toLowerCase()
  )
}

/**
 * 回收监听指定端口的残留后端进程。
 *
 * 硬杀终端或强杀 pnpm 时，dev 后端可能变成孤儿进程占着端口，
 * 导致 go build 覆盖失败、新实例 bind 失败（EADDRINUSE）。
 * 只回收 binPath 编译出的进程，被其它程序占用时返回 blocked 交给调用方处理。
 *
 * @returns {{ reclaimed: number[], blocked: { pid: number, image: string } | null, released: boolean }}
 *   reclaimed 已回收（或 dry-run 下将回收）的 PID；blocked 端口被其它程序占用；released 返回时端口是否空闲
 */
export function reclaimPort({
  port,
  binPath,
  dryRun = false,
  waitMs = 5000,
  log = () => {},
}) {
  const reclaimed = []
  for (const pid of listenersOnPort(port)) {
    const image = imagePathOf(pid)
    if (!isOurBackend(image, binPath)) {
      return { reclaimed, blocked: { pid, image }, released: false }
    }
    log(`回收残留后端：PID ${pid} 占用端口 ${port}`)
    reclaimed.push(pid)
    if (!dryRun) killTree(pid)
  }
  if (dryRun) {
    return {
      reclaimed,
      blocked: null,
      released: listenersOnPort(port).length === 0,
    }
  }
  if (reclaimed.length === 0) {
    return { reclaimed, blocked: null, released: true }
  }
  const deadline = Date.now() + waitMs
  while (listenersOnPort(port).length > 0 && Date.now() < deadline) {
    sleep(200)
  }
  return {
    reclaimed,
    blocked: null,
    released: listenersOnPort(port).length === 0,
  }
}
