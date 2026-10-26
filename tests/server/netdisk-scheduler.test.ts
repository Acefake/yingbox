/**
 * 定时器单例：同一数据目录只有一个实例持有调度租约并跑定时任务；持有者失联超过租期后被接管；
 * 进程内同名任务只登记一次；YINGBOX_AUTOGRAB=off 的实例只登记不执行。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SchedulerLease } from '../../src/server/netdisk/lease'
import { createLeasedScheduler } from '../../src/server/netdisk/scheduler'
import { loadNetdiskConfig } from '../../src/server/netdisk/config'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-lease-'))
  file = join(dir, 'scheduler.lock')
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('SchedulerLease', () => {
  it('只有一个实例能取得；放手后另一个才能取得', () => {
    const a = new SchedulerLease({ file, owner: 'a' })
    const b = new SchedulerLease({ file, owner: 'b' })
    expect(a.tryAcquire()).toBe(true)
    expect(b.tryAcquire()).toBe(false)
    expect(a.renew()).toBe(true)
    a.release()
    expect(b.tryAcquire()).toBe(true)
    expect(a.tryAcquire()).toBe(false)
  })

  it('持有者超过租期没续时被接管，原持有者续租时发现并放手', () => {
    let now = 1_000_000
    const a = new SchedulerLease({
      file,
      owner: 'a',
      ttlMs: 1000,
      now: () => now,
    })
    const b = new SchedulerLease({
      file,
      owner: 'b',
      ttlMs: 1000,
      now: () => now,
    })
    expect(a.tryAcquire()).toBe(true)
    now += 999
    expect(b.tryAcquire()).toBe(false)
    now += 2
    expect(b.tryAcquire()).toBe(true)
    expect(a.renew()).toBe(false)
    expect(a.held).toBe(false)
  })

  it('损坏的租约文件当作已过期', () => {
    writeFileSync(file, 'not json')
    expect(new SchedulerLease({ file, owner: 'a' }).tryAcquire()).toBe(true)
  })
})

describe('createLeasedScheduler', () => {
  const task = (name: string, run: () => void) => ({
    name,
    firstDelayMs: 100,
    intervalMs: 1000,
    run,
  })

  it('两个实例共用一个数据目录：任务只在一个实例上跑', () => {
    vi.useFakeTimers()
    const runs = { a: 0, b: 0 }
    const log = vi.fn()
    const a = createLeasedScheduler({
      lease: new SchedulerLease({ file, owner: 'a' }),
      enabled: true,
      log,
    })
    const b = createLeasedScheduler({
      lease: new SchedulerLease({ file, owner: 'b' }),
      enabled: true,
      log,
    })
    a.schedule(task('autograb', () => runs.a++))
    b.schedule(task('autograb', () => runs.b++))
    vi.advanceTimersByTime(100 + 3000)
    expect(runs.a).toBe(4)
    expect(runs.b).toBe(0)
    // a 退出（放手）后 b 下一轮接手
    a.close()
    vi.advanceTimersByTime(1000)
    expect(runs.b).toBe(1)
    b.close()
  })

  it('进程内同名任务只登记一次', () => {
    vi.useFakeTimers()
    let runs = 0
    const log = vi.fn()
    const s = createLeasedScheduler({
      lease: new SchedulerLease({ file }),
      enabled: true,
      log,
    })
    s.schedule(task('autograb', () => runs++))
    s.schedule(task('autograb', () => runs++))
    expect(s.names()).toEqual(['autograb'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('忽略重复登记'))
    vi.advanceTimersByTime(100)
    expect(runs).toBe(1)
    s.close()
  })

  it('enabled=false 只登记不执行，也不抢租约', () => {
    vi.useFakeTimers()
    let runs = 0
    const lease = new SchedulerLease({ file, owner: 'off' })
    const s = createLeasedScheduler({ lease, enabled: false, log: () => {} })
    s.schedule(task('autograb', () => runs++))
    vi.advanceTimersByTime(10_000)
    expect(runs).toBe(0)
    expect(lease.held).toBe(false)
    s.close()
  })

  it('任务抛错不影响下一轮', () => {
    vi.useFakeTimers()
    let runs = 0
    const log = vi.fn()
    const s = createLeasedScheduler({
      lease: new SchedulerLease({ file }),
      enabled: true,
      log,
    })
    s.schedule(
      task('boom', () => {
        runs++
        throw new Error('炸了')
      })
    )
    vi.advanceTimersByTime(1100)
    expect(runs).toBe(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('炸了'))
    s.close()
  })
})

describe('loadNetdiskConfig', () => {
  it('默认都开；off / 0 / false 关；乱写报错', () => {
    expect(loadNetdiskConfig({})).toEqual({ enabled: true, autograb: true })
    expect(loadNetdiskConfig({ YINGBOX_AUTOGRAB: 'off' })).toEqual({
      enabled: true,
      autograb: false,
    })
    expect(loadNetdiskConfig({ YINGBOX_NETDISK: '0' }).enabled).toBe(false)
    expect(() => loadNetdiskConfig({ YINGBOX_AUTOGRAB: 'maybe' })).toThrow(
      'on 或 off'
    )
  })
})
