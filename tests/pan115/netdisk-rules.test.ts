/**
 * 网盘页的纯函数：显示格式与扫码轮询循环。
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  type LoginOutcome,
  formatBytes,
  formatDay,
  pollLogin,
  sourceLabel,
  titleSpecs,
} from '../../src/renderer/src/features/netdisk/utils/netdisk-rules'
import type { Pan115LoginPoll } from '../../src/shared/contract/pan115'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('netdisk-rules', () => {
  it('formatBytes / formatDay / sourceLabel', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB')
    expect(formatDay('bad')).toBe('')
    expect(formatDay(undefined)).toBe('')
    expect(sourceLabel('tg:Channel_Shares_115')).toBe('TG · Channel_Shares_115')
    expect(sourceLabel('plugin:hdr4k')).toBe('插件 · hdr4k')
    expect(sourceLabel('unknown')).toBe('')
  })

  it('formatDay 按本地时区取日期（固定时区断言，不依赖跑测试的机器）', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    expect(formatDay('2026-09-30T16:30:00Z')).toBe('2026-10-01')
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(formatDay('2026-10-01T05:00:00Z')).toBe('2026-09-30')
    vi.stubEnv('TZ', 'UTC')
    expect(formatDay('2026-10-01T00:00:00Z')).toBe('2026-10-01')
  })

  it('LoginOutcome 只剩终态（类型断言）', () => {
    expectTypeOf<LoginOutcome['status']>().toEqualTypeOf<
      'expired' | 'canceled' | 'done' | 'error'
    >()
  })

  it('pollLogin：等到 done 为止，并报告每次状态', async () => {
    const answers: Pan115LoginPoll[] = [
      { status: 'waiting' },
      { status: 'scanned' },
      {
        status: 'done',
        account: { loggedIn: true, userId: '1', userName: 'a' },
      },
    ]
    const poll = vi.fn(async () => answers.shift()!)
    const seen: string[] = []
    const outcome = await pollLogin(poll, {
      signal: new AbortController().signal,
      onStatus: s => seen.push(s),
      intervalMs: 0,
    })
    expect(outcome.status).toBe('done')
    expect(seen).toEqual(['waiting', 'scanned', 'done'])
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('pollLogin：过期即停；取消后以 canceled 结束、不再报告', async () => {
    const expired = await pollLogin(async () => ({ status: 'expired' }), {
      signal: new AbortController().signal,
      onStatus: () => {},
      intervalMs: 0,
    })
    expect(expired).toEqual({ status: 'expired' })

    const controller = new AbortController()
    const seen: string[] = []
    const outcome = await pollLogin(
      async () => {
        controller.abort()
        return { status: 'waiting' }
      },
      { signal: controller.signal, onStatus: s => seen.push(s), intervalMs: 0 }
    )
    expect(outcome).toEqual({ status: 'canceled' })
    expect(seen).toEqual([])
  })

  it('titleSpecs：从分享标题认出分辨率、动态范围、音轨与中字', () => {
    const texts = (title: string): string[] =>
      titleSpecs(title).map(s => `${s.variant}:${s.text}`)
    expect(texts('三体 (2023) 4K 杜比视界 全30集 国语中字 腾讯版')).toEqual([
      'solid:4K',
      'dolby:VISION',
      'outline:中字',
    ])
    expect(
      texts('三体 3 Body Problem S01 2160p WEB-DL DDP5.1 Atmos 中英双字')
    ).toEqual(['solid:4K', 'dolby:ATMOS', 'outline:中字'])
    expect(texts('漫长的季节 (2023) 1080P 全12集')).toEqual(['outline:1080P'])
    expect(texts('繁花 2160p HDR DV 内封简繁')).toEqual([
      'solid:4K',
      'dolby:VISION',
      'outline:中字',
    ])
    expect(texts('封神第一部 HDR10 IMAX')).toEqual(['solid:HDR'])
    // DV 只认独立的词，不误认 DVD
    expect(texts('老电影 DVDRip')).toEqual([])
    // 点分隔的 Dolby.Vision 也认，且和 HDR 同时出现时只留杜比视界
    expect(texts('Dune.Part.Two.2024.2160p.Dolby.Vision.HDR.mkv')).toEqual([
      'solid:4K',
      'dolby:VISION',
    ])
    // HDRip 是片源标签，不是动态范围
    expect(texts('某电影.2019.1080p.HDRip.x264')).toEqual(['outline:1080P'])
    expect(texts('封神第一部 HDR10+')).toEqual(['solid:HDR'])
  })
})
