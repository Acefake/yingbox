import { describe, expect, it, vi } from 'vitest'

import { cardsOf, searchCards } from '../../src/server/view/search'
import type { SourceDeps } from '../../src/server/view/sources'
import type { CmsItem } from '../../src/shared/online/types'

const item = (
  name: string,
  site: string,
  extra: Partial<CmsItem> = {}
): CmsItem => ({
  vod_id: 1,
  vod_name: name,
  type_name: '',
  vod_year: '',
  vod_remarks: '',
  vod_pic: '',
  _source: 'cms',
  api_url: `https://${site}.example.com/api`,
  ...extra,
})

describe('搜索结果合成卡（cardsOf）', () => {
  it('片名相同的合成一张，站点多的排前，取第一张可用的海报', () => {
    const cards = cardsOf(
      [
        item('小城良方', 'a'),
        item('小城良方 第二季', 'a'),
        item('小城良方', 'b', {
          vod_pic: 'https://img.example.com/p.jpg',
          vod_year: '2026',
        }),
        item('别的片', 'a'),
      ],
      '小城良方'
    )
    expect(cards.map(card => card.title)).toEqual([
      '小城良方',
      '小城良方 第二季',
    ])
    expect(cards[0]).toMatchObject({ siteCount: 2, year: '2026' })
    expect(cards[0].poster).toMatch(/^\/media\/thumb\?/)
    expect(cards[1].siteCount).toBe(1)
  })

  it('与关键词无关的条目不要', () => {
    expect(cardsOf([item('别的片', 'a')], '小城良方')).toEqual([])
  })
})

describe('搜索（searchCards）', () => {
  const deps = (overrides: Partial<SourceDeps> = {}): SourceDeps => ({
    cmsSites: () => [
      {
        key: 'a',
        name: '站甲',
        api: 'https://a.example.com/api.php',
        detail: '',
      },
      {
        key: 'b',
        name: '站乙',
        api: 'https://b.example.com/api.php',
        detail: '',
      },
    ],
    pluginSites: async () => [],
    getJson: vi.fn(async (url: string) =>
      url.startsWith('https://b.')
        ? { success: false as const, error: '超时' }
        : {
            success: true as const,
            data: {
              list: [
                {
                  vod_id: 1,
                  vod_name: '小城良方',
                  vod_pic: 'https://img.example.com/p.jpg',
                },
              ],
            },
          }
    ),
    vod: vi.fn(async () => ({ success: false as const, error: '无' })),
    ...overrides,
  })

  it('某个站点失败只是少了它', async () => {
    const cards = await searchCards('小城良方', deps())
    expect(cards).toHaveLength(1)
    expect(cards[0].siteCount).toBe(1)
  })

  it('空关键词不发请求', async () => {
    const d = deps()
    expect(await searchCards('  ', d)).toEqual([])
    expect(d.getJson).not.toHaveBeenCalled()
  })
})
