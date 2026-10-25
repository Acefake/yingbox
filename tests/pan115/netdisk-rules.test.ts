/**
 * 网盘页的纯函数：显示格式与扫码轮询循环。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  formatBytes,
  formatDay,
  pollLogin,
  sourceLabel,
} from '../../src/renderer/src/features/netdisk/utils/netdisk-rules'
import type { Pan115LoginPoll } from '../../src/shared/contract/pan115'

describe('netdisk-rules', () => {
  it('formatBytes / formatDay / sourceLabel', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB')
    expect(formatDay('2026-10-01T08:00:00Z')).toMatch(/^2026-10-0[12]$/)
    expect(formatDay('bad')).toBe('')
    expect(formatDay(undefined)).toBe('')
    expect(sourceLabel('tg:Channel_Shares_115')).toBe('TG · Channel_Shares_115')
    expect(sourceLabel('plugin:hdr4k')).toBe('插件 · hdr4k')
    expect(sourceLabel('unknown')).toBe('')
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
})
