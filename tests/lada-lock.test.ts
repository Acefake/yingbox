import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireLock,
  clearStaleLock,
  isProcessAlive,
  lockPath,
  parseLock,
  readLock,
  releaseLock,
} from '../src/main/lada-lock'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lada-lock-'))
  mkdirSync(join(root, 'yingbox-lada'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('treats invalid pids and definitely-dead pids as dead', () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
    // Windows 上 pid 上限远小于这个值，必然不存在
    expect(isProcessAlive(999999999)).toBe(false)
  })
})

describe('parseLock', () => {
  it('accepts a valid lock and rejects garbage', () => {
    expect(parseLock(JSON.stringify({ pid: 123, input: 'a.mp4' }))).toEqual({ pid: 123, input: 'a.mp4' })
    expect(parseLock('not json')).toBeNull()
    expect(parseLock('{}')).toBeNull()
    expect(parseLock(JSON.stringify({ pid: 'x' }))).toBeNull()
    expect(parseLock(JSON.stringify({ pid: -3 }))).toBeNull()
  })
})

describe('acquire / release', () => {
  it('grants a free lock and rejects a second holder', () => {
    expect(acquireLock(root, { pid: process.pid, input: 'a.mp4' })).toBe(true)
    expect(readLock(root)?.pid).toBe(process.pid)
    // 已被活进程持有 → 拒绝
    expect(acquireLock(root, { pid: process.pid, input: 'b.mp4' })).toBe(false)
  })

  it('releases only the matching pid', () => {
    acquireLock(root, { pid: process.pid, input: 'a.mp4' })
    releaseLock(root, process.pid + 1) // 别人的锁，不动
    expect(readLock(root)?.pid).toBe(process.pid)
    releaseLock(root, process.pid)
    expect(readLock(root)).toBeNull()
  })
})

describe('stale locks', () => {
  it('ignores and cleans a lock whose owner is dead', () => {
    writeFileSync(lockPath(root), JSON.stringify({ pid: 999999999, input: 'dead.mp4' }))
    // 持有者已死 → 视为无锁
    expect(readLock(root)).toBeNull()
    // 可以接管，且过期文件被清掉后重新写入
    expect(acquireLock(root, { pid: process.pid, input: 'new.mp4' })).toBe(true)
    expect(readLock(root)?.input).toBe('new.mp4')
  })

  it('creates the directory when it does not exist yet', () => {
    const missing = join(root, 'never', 'created')
    expect(acquireLock(missing, { pid: process.pid })).toBe(true)
    expect(readLock(missing)?.pid).toBe(process.pid)
    // 第二个持有者依然被拒
    expect(acquireLock(missing, { pid: process.pid })).toBe(false)
  })

  it('never reports success when the lock cannot be written', () => {
    // 目标路径上放一个同名文件，使 lockPath 变成一个目录都建不出来的位置
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'i am a file, not a directory')
    expect(acquireLock(blocked, { pid: process.pid })).toBe(false)
    expect(readLock(blocked)).toBeNull()
  })

  it('clears a corrupt lock file', () => {
    writeFileSync(lockPath(root), 'not json at all')
    expect(clearStaleLock(root)).toBe(true)
    expect(readLock(root)).toBeNull()
  })

  it('keeps a lock held by a live process', () => {
    writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid }))
    expect(clearStaleLock(root)).toBe(false)
    expect(readFileSync(lockPath(root), 'utf8')).toContain(String(process.pid))
  })
})
