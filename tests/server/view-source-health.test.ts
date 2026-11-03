import { describe, expect, it, vi } from 'vitest'

import {
  type HealthRecord,
  type SourceHealth,
  createSourceHealth,
  parseHealth,
} from '../../src/server/view/source-health'
import type { SourceDeps } from '../../src/server/view/sources'
import type { CatSpiderSite } from '../../src/shared/online/types'

const plugin = (name: string): CatSpiderSite =>
  ({ name, api: name, ext: '' }) as unknown as CatSpiderSite

function setup(overrides: Partial<SourceDeps> = {}): {
  health: SourceHealth
  deps: SourceDeps
  saved: () => HealthRecord
} {
  let saved: HealthRecord = {}
  const deps: SourceDeps = {
    cmsSites: () => [
      {
        key: 'a',
        name: '好站',
        api: 'https://a.example.com/api.php',
        detail: '',
      },
      {
        key: 'b',
        name: '坏站',
        api: 'https://b.example.com/api.php',
        detail: '',
      },
      {
        key: 'c',
        name: '没列表',
        api: 'https://c.example.com/api.php',
        detail: '',
      },
      {
        key: 'd',
        name: '引擎抖了',
        api: 'https://d.example.com/api.php',
        detail: '',
      },
    ],
    pluginSites: async () => [
      plugin('好插件'),
      plugin('熔断插件'),
      plugin('空结果插件'),
    ],
    getJson: vi.fn(async (url: string) => {
      const host = new URL(url).hostname
      if (host === 'b.example.com')
        return { success: false as const, error: '超时' }
      if (host === 'c.example.com')
        return { success: true as const, data: { code: 1 } }
      if (host === 'd.example.com') throw new Error('引擎没起来')
      return { success: true as const, data: { list: [{ vod_id: 1 }] } }
    }),
    vod: vi.fn(async (request: { siteName: string }) => {
      if (request.siteName === '熔断插件')
        return {
          success: true,
          data: { list: [] },
          unavailable: { kind: 'blocked' },
        }
      if (request.siteName === '空结果插件')
        return { success: true, data: { list: [] } }
      return { success: true, data: { list: [{ vod_name: '电影' }] } }
    }) as unknown as SourceDeps['vod'],
    ...overrides,
  }
  const health = createSourceHealth(deps, {
    read: () => saved,
    write: record => {
      saved = record
    },
  })
  return { health, deps, saved: () => saved }
}

describe('在线源体检', () => {
  it('通的启用、不通的停用；没有列表算不通，空列表算通，引擎抖了保持原状', async () => {
    const { health, saved } = setup()
    expect(health.usable('坏站')).toBe(true) // 没检测过算能用
    await health.start()
    expect(saved()).toEqual({
      好站: true,
      坏站: false,
      没列表: false,
      好插件: true,
      熔断插件: false,
      空结果插件: true,
    })
    expect(health.usable('坏站')).toBe(false)
    expect(health.usable('好站')).toBe(true)
    expect(health.usable('引擎抖了')).toBe(true)
    expect(health.disabled().sort()).toEqual(
      ['坏站', '没列表', '熔断插件'].sort()
    )
    expect(health.status()).toMatchObject({
      checking: false,
      done: 7,
      total: 7,
    })
  })

  it('重新检测时上一轮不通的站点恢复了就重新启用', async () => {
    let up = false
    const { health, deps } = setup()
    ;(deps.getJson as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) =>
        new URL(url).hostname === 'b.example.com' && !up
          ? { success: false as const, error: '超时' }
          : { success: true as const, data: { list: [] } }
    )
    await health.start()
    expect(health.usable('坏站')).toBe(false)
    up = true
    await health.start()
    expect(health.usable('坏站')).toBe(true)
  })

  it('一轮里一个源都没通（断网）不改原状态，不把全部源停用', async () => {
    const { health, deps, saved } = setup()
    await health.start()
    const before = saved()
    ;(deps.getJson as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: '断网',
    })
    ;(deps.vod as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: '断网',
    })
    await health.start()
    expect(saved()).toEqual(before)
    expect(health.usable('好站')).toBe(true)
  })

  it('已经不在站点清单里的站点从结果里丢掉', async () => {
    const { health, deps, saved } = setup()
    await health.start()
    expect(Object.keys(saved())).toContain('坏站')
    deps.cmsSites = () => [
      {
        key: 'a',
        name: '好站',
        api: 'https://a.example.com/api.php',
        detail: '',
      },
    ]
    await health.start()
    expect(Object.keys(saved())).not.toContain('坏站')
  })

  it('检测在进行中时重复调用复用同一轮', async () => {
    const { health, deps } = setup()
    await Promise.all([health.start(), health.start()])
    expect((deps.getJson as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      4
    )
  })

  it('重启后沿用持久化的结果；坏数据当作没有', () => {
    expect(parseHealth({ 甲: true, 乙: false, 丙: 'x', 丁: null })).toEqual({
      甲: true,
      乙: false,
    })
    expect(parseHealth([1, 2])).toEqual({})
  })
})
