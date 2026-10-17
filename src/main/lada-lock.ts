/**
 * 去码任务的**机器级**单任务锁。
 *
 * 为什么需要：lada 吃满 6GB 显存，一次只能跑一个。影盒允许同时开多个实例
 * （不同窗口、不同 user-data-dir），普通的内存标记互相看不见，两个 lada 一起跑
 * 就会互相把对方打到 CUDA OOM（真实发生过）。
 *
 * 做法：在系统临时目录放一个锁文件，内容含持有者 PID。跨实例可见。
 * 进程已死（或锁内容损坏）视为过期，可接管。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface JobLock {
  pid: number
  input?: string
  startedAt?: number
  /** 写锁的实例标识，便于提示用户 */
  tag?: string
}

/** 锁文件路径（tempDir 就是 lada 的临时目录） */
export function lockPath(tempDir: string): string {
  return join(tempDir, 'job.lock')
}

/** 进程是否还活着（用于判断锁是否过期） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM：进程存在但没权限（仍算活着）；ESRCH：不存在
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 解析锁内容；损坏返回 null */
export function parseLock(raw: string): JobLock | null {
  try {
    const data = JSON.parse(raw) as JobLock
    if (!data || typeof data.pid !== 'number' || !Number.isSafeInteger(data.pid) || data.pid <= 0) return null
    return data
  } catch {
    return null
  }
}

/** 读取当前锁；不存在或已过期返回 null */
export function readLock(tempRoot: string): JobLock | null {
  const file = lockPath(tempRoot)
  if (!existsSync(file)) return null
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const lock = parseLock(raw)
  if (!lock) return null
  return isProcessAlive(lock.pid) ? lock : null
}

/** 清理过期锁文件（进程已死或内容损坏） */
export function clearStaleLock(tempRoot: string): boolean {
  const file = lockPath(tempRoot)
  if (!existsSync(file)) return false
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return false
  }
  const lock = parseLock(raw)
  if (lock && isProcessAlive(lock.pid)) return false
  try {
    rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}

/** 写入锁；已被活进程占用或无法写入时返回 false（绝不谎报成功） */
export function acquireLock(tempDir: string, lock: JobLock): boolean {
  const file = lockPath(tempDir)
  if (readLock(tempDir)) return false
  // 走到这里说明没有活锁；顺手清掉可能残留的过期文件
  clearStaleLock(tempDir)
  const attempt = (): boolean => {
    try {
      writeFileSync(file, JSON.stringify(lock), { flag: 'wx' })
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return false // 别人抢先了
      if (code === 'ENOENT') {
        // 目录还没建出来。别把它当成"抢到了"——那正是之前两个实例同时开跑的元凶。
        try {
          mkdirSync(tempDir, { recursive: true })
          writeFileSync(file, JSON.stringify(lock), { flag: 'wx' })
          return true
        } catch {
          return false
        }
      }
      return false
    }
  }
  return attempt()
}

/** 释放锁（只释放自己的） */
export function releaseLock(tempRoot: string, pid: number): void {
  const file = lockPath(tempRoot)
  if (!existsSync(file)) return
  try {
    const lock = parseLock(readFileSync(file, 'utf8'))
    if (lock && lock.pid !== pid) return
    rmSync(file, { force: true })
  } catch {
    /* 释放失败不影响主流程；下次启动会清扫 */
  }
}
