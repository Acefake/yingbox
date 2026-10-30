import { describe, expect, it } from 'vitest'
import {
  CMS_COOLDOWN,
  CMS_HEALTH_TTL,
  canUse,
  nextHealth,
  parseHealthCache,
  probeDue,
} from '../src/renderer/src/features/online/utils/cms-health'

describe('CMS 健康规则', () => {
  it('健康缓存到期才探测，正常空列表对应成功记录', () => {
    const ok = nextHealth(undefined, '', 1000)
    expect(ok.failures).toBe(0)
    expect(probeDue(ok, 1001)).toBe(false)
    expect(probeDue(ok, 1000 + CMS_HEALTH_TTL)).toBe(true)
  })
  it('一次失败不隔离，第三次失败冷却，到期恢复尝试', () => {
    const first = nextHealth(undefined, '连接超时', 1000)
    const second = nextHealth(first, '连接超时', 2000)
    const third = nextHealth(second, '连接超时', 3000)
    expect(canUse(first, 1001)).toBe(true)
    expect(probeDue(first, 1001)).toBe(false)
    expect(canUse(second, 2001)).toBe(true)
    expect(canUse(third, 3001)).toBe(false)
    expect(canUse(third, 3000 + CMS_COOLDOWN)).toBe(true)
    expect(nextHealth(third, '', 4000)).toEqual({
      checkedAt: 4000,
      failures: 0,
      until: 0,
      error: '',
    })
  })
  it('缓存只接收有效的能力记录，坏数据不阻断启动', () => {
    expect(parseHealthCache('{')).toEqual({})
    expect(
      parseHealthCache(
        JSON.stringify({
          a: {
            search: { checkedAt: 1, failures: 3, until: 100, error: '失败' },
            detail: { checkedAt: 'bad' },
          },
        })
      )
    ).toEqual({
      a: { search: { checkedAt: 1, failures: 3, until: 100, error: '失败' } },
    })
  })
})
