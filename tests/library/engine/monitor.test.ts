/**
 * 目录监控与写入稳定判定：监控通道选择（事件 / 定时扫描 / 降级）、复查合并、
 * 网络文件系统识别、SettleTracker 规则，以及扫描时摘掉还在写入的文件。
 */
import { appendFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LibraryMonitor,
  type MonitorOptions,
  describeWatchError,
} from '../../../src/main/library/engine/library-monitor'
import {
  detectUnreliableFs,
  unreliableFsName,
} from '../../../src/main/library/scanner/fs-type'
import { SettleTracker } from '../../../src/main/library/scanner/settle'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { age, scanEnv, tempTree } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

describe('SettleTracker', () => {
  it('settleMs 为 0 时全部稳定', () => {
    const t = new SettleTracker(0)
    expect(t.check({ key: 'a', size: 1, mtime: 0 }, 0, false)).toEqual({
      stable: true,
    })
  })

  it('新到文件要两次观察大小 / mtime 不变且间隔够长', () => {
    const t = new SettleTracker(1000)
    const f = { key: 'a', size: 10, mtime: 0 }
    expect(t.check(f, 5000, false)).toEqual({ stable: false, retryInMs: 1000 })
    expect(t.check(f, 5400, false)).toEqual({ stable: false, retryInMs: 600 })
    // 大小变了：重新计时
    expect(t.check({ ...f, size: 20 }, 5800, false)).toEqual({
      stable: false,
      retryInMs: 1000,
    })
    expect(t.check({ ...f, size: 20 }, 6800, false)).toEqual({ stable: true })
    expect(t.pending).toBe(0)
  })

  it('首扫：mtime 足够旧的存量文件直接收，太新的照样等', () => {
    const t = new SettleTracker(1000)
    expect(t.check({ key: 'old', size: 1, mtime: 0 }, 5000, true).stable).toBe(
      true
    )
    expect(
      t.check({ key: 'new', size: 1, mtime: 4500 }, 5000, true).stable
    ).toBe(false)
  })

  it('很久没再见到的观察记录会被丢弃', () => {
    const t = new SettleTracker(100)
    t.check({ key: 'a', size: 1, mtime: 0 }, 0, false)
    t.prune(1000)
    expect(t.pending).toBe(1)
    t.prune(2001)
    expect(t.pending).toBe(0)
  })
})

describe('scanLibrary + 写入稳定判定', () => {
  it('还在写入的视频这一轮不入库，目录记不可信 mtime；写完后复扫入库', async () => {
    const tree = tempTree()
    const env = scanEnv(tree.root)
    try {
      tree.write('A (2001)/A (2001).mkv', 'a')
      age(join(tree.root, 'A (2001)/A (2001).mkv'))
      const tracker = new SettleTracker(1000)
      let clock = Date.now()
      const settle = { tracker, initial: true }
      const first = await env.scan({ settle, now: () => clock })
      expect(first.added).toBe(1)
      expect(first.unsettled).toBeNull()

      // 新文件：大小还在变
      const path = tree.write('B (2002)/B (2002).mkv', 'b')
      age(path)
      const later = { tracker, initial: false }
      const second = await env.scan({ settle: later, now: () => clock })
      expect(second.added).toBe(0)
      expect(second.unsettled).toEqual({
        dirs: [join(tree.root, 'B (2002)')],
        retryInMs: 1000,
      })
      appendFileSync(path, 'more')
      clock += 1500
      const third = await env.scan({
        settle: later,
        now: () => clock,
        scope: second.unsettled!.dirs,
      })
      expect(third.added).toBe(0)
      expect(third.unsettled?.dirs).toEqual([join(tree.root, 'B (2002)')])

      // 不再变化，过了 settle 时间：普通增量扫描（不带 scope）也会重读这个目录并入库
      clock += 1500
      const fourth = await env.scan({ settle: later, now: () => clock })
      expect(fourth.added).toBe(1)
      expect(fourth.unsettled).toBeNull()
      const titles = env.query
        .list(normalizeLibraryQuery({}))
        .items.map(i => i.title)
      expect(titles).toEqual(['A', 'B'])
    } finally {
      env.db.close()
      tree.cleanup()
    }
  })

  it('同盘改名是原子的：移动目标不等稳定，匹配跟着走', async () => {
    const tree = tempTree()
    const env = scanEnv(tree.root)
    try {
      tree.write('In/Movie (2001).mkv', 'x'.repeat(4096))
      age(join(tree.root, 'In/Movie (2001).mkv'))
      const tracker = new SettleTracker(60_000)
      await env.scan({ settle: { tracker, initial: true } })
      renameSync(
        join(tree.root, 'In/Movie (2001).mkv'),
        join(tree.root, 'Movie (2001).mkv')
      )
      const summary = await env.scan({ settle: { tracker, initial: false } })
      expect(summary.moved).toHaveLength(1)
      expect(summary.unsettled).toBeNull()
    } finally {
      env.db.close()
      tree.cleanup()
    }
  })
})

describe('网络文件系统识别', () => {
  it('statfs 魔数：NFS / CIFS / SMB2 / FUSE / 9p 不可靠，ext4 / overlay 可靠', () => {
    expect(unreliableFsName(0x6969)).toBe('nfs')
    expect(unreliableFsName(0xff534d42)).toBe('cifs')
    // 部分平台把 f_type 当有符号数返回
    expect(unreliableFsName(0xfe534d42 | 0)).toBe('smb2')
    expect(unreliableFsName(0x65735546)).toBe('fuse')
    expect(unreliableFsName(0x01021997)).toBe('9p')
    expect(unreliableFsName(0xef53)).toBeUndefined()
    expect(unreliableFsName(0x794c7630)).toBeUndefined()
  })

  it('非 Linux 一律按可靠处理；路径不存在不抛错', async () => {
    expect(await detectUnreliableFs('/', 'darwin')).toBeUndefined()
    expect(await detectUnreliableFs('/no/such/dir', 'linux')).toBeUndefined()
  })

  it('错误码翻译', () => {
    const err = Object.assign(new Error('x'), { code: 'ENOSPC' })
    expect(describeWatchError(err)).toMatch(/max_user_watches/)
  })
})

describe('LibraryMonitor', () => {
  type Scan = [number, string[] | null]
  const monitor = (
    options: Partial<MonitorOptions>,
    scans: Scan[]
  ): { m: LibraryMonitor; logs: string[] } => {
    const logs: string[] = []
    const m = new LibraryMonitor(
      {
        mode: 'auto',
        pollIntervalMs: 0,
        detectFs: async () => undefined,
        log: message => logs.push(message),
        ...options,
      },
      (id, dirs) => scans.push([id, dirs])
    )
    return { m, logs }
  }

  it('auto：本地盘用事件；网络盘只用定时扫描，并说明原因', async () => {
    const tree = tempTree()
    const scans: Scan[] = []
    const { m, logs } = monitor(
      { detectFs: async root => (root.endsWith('nas') ? 'nfs' : undefined) },
      scans
    )
    try {
      await m.add(1, tree.root)
      expect(m.channel(1)).toBe('events')
      await m.add(2, '/mnt/nas')
      expect(m.channel(2)).toBe('poll')
      expect(logs[0]).toMatch(/nfs.*定时扫描已关闭/)
    } finally {
      m.close()
      tree.cleanup()
    }
  })

  it('定时扫描按间隔排整库增量扫描；catchUp 立即补一次；remove 后停止', async () => {
    vi.useFakeTimers()
    const scans: Scan[] = []
    const { m } = monitor({ mode: 'poll', pollIntervalMs: 1000 }, scans)
    await m.add(7, '/media/a', true)
    expect(scans).toEqual([[7, null]])
    vi.advanceTimersByTime(2500)
    expect(scans).toEqual([
      [7, null],
      [7, null],
      [7, null],
    ])
    m.remove(7)
    vi.advanceTimersByTime(5000)
    expect(scans).toHaveLength(3)
    expect(m.channel(7)).toBe('off')
  })

  it('事件启动失败（根目录不存在 / inotify 满）时退回定时扫描', async () => {
    const scans: Scan[] = []
    const { m, logs } = monitor(
      { mode: 'events', pollIntervalMs: 60_000 },
      scans
    )
    await m.add(3, '/definitely/not/here')
    expect(m.channel(3)).toBe('poll')
    expect(logs[0]).toMatch(/无法监听.*每 60 秒/)
    m.close()
  })

  it('off：不监听也不定时扫描', async () => {
    const scans: Scan[] = []
    const { m } = monitor({ mode: 'off', pollIntervalMs: 10 }, scans)
    await m.add(1, '/x', true)
    expect(m.channel(1)).toBe('off')
    expect(scans).toEqual([])
    m.close()
  })

  it('复查：合并目录、取较早的时间，到点排一次定向扫描', () => {
    vi.useFakeTimers()
    const scans: Scan[] = []
    const { m } = monitor({ mode: 'off' }, scans)
    m.recheck(1, ['/a'], 1000)
    m.recheck(1, ['/b'], 3000)
    m.recheck(1, ['/c'], 500)
    vi.advanceTimersByTime(499)
    expect(scans).toEqual([])
    vi.advanceTimersByTime(1)
    expect(scans).toEqual([[1, ['/a', '/b', '/c']]])
    vi.advanceTimersByTime(5000)
    expect(scans).toHaveLength(1)
    m.close()
  })
})
