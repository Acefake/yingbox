/**
 * 片库服务的目录监控配置：默认值、环境变量、命令行参数优先、非法值报错、启动日志文字。
 */
import { describe, expect, it } from 'vitest'
import { describeMonitor, loadConfig } from '../../src/server/config'

const defaults = { cwd: '/srv', home: '/home/u', bundleDir: '/nowhere/out' }

describe('监控配置', () => {
  it('默认 auto、5 分钟定时扫描、10 秒写入稳定判定', () => {
    expect(loadConfig([], {}, defaults).monitor).toEqual({
      watchMode: 'auto',
      scanIntervalMs: 300_000,
      settleMs: 10_000,
    })
  })

  it('环境变量（秒）与命令行参数，参数优先；0 关闭', () => {
    const env = {
      YINGBOX_WATCH: 'poll',
      YINGBOX_SCAN_INTERVAL: '60',
      YINGBOX_SETTLE_SECONDS: '2.5',
    }
    expect(loadConfig([], env, defaults).monitor).toEqual({
      watchMode: 'poll',
      scanIntervalMs: 60_000,
      settleMs: 2500,
    })
    expect(
      loadConfig(['--watch=off', '--scan-interval', '0'], env, defaults).monitor
    ).toEqual({ watchMode: 'off', scanIntervalMs: 0, settleMs: 2500 })
  })

  it('非法值直接报错', () => {
    expect(() =>
      loadConfig([], { YINGBOX_WATCH: 'inotify' }, defaults)
    ).toThrow(/监控模式/)
    expect(() =>
      loadConfig([], { YINGBOX_SCAN_INTERVAL: '-1' }, defaults)
    ).toThrow(/定时扫描间隔/)
    expect(() =>
      loadConfig([], { YINGBOX_SETTLE_SECONDS: 'abc' }, defaults)
    ).toThrow(/写入稳定时间/)
  })

  it('启动日志', () => {
    expect(
      describeMonitor({
        watchMode: 'auto',
        scanIntervalMs: 300_000,
        settleMs: 10_000,
      })
    ).toBe(
      '自动（本地盘用文件系统事件，网络盘 / 挂载盘按网盘处理），每 300 秒增量扫描，文件 10 秒不变再入库；网盘不监听、不定时扫描，只按变更通知与手动扫描'
    )
    expect(
      describeMonitor({ watchMode: 'off', scanIntervalMs: 1, settleMs: 1 })
    ).toBe('关闭（只能手动扫描）')
    expect(
      describeMonitor({
        watchMode: 'poll',
        scanIntervalMs: 60_000,
        settleMs: 0,
      })
    ).toBe(
      '只用定时扫描，每 60 秒增量扫描，不等文件写完；网盘不监听、不定时扫描，只按变更通知与手动扫描'
    )
  })
})
