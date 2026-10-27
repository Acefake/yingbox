import { describe, expect, it } from 'vitest'

import { createDoubanBrowse } from '../src/engine/online/douban-browse'
import {
  WEEKLY_MOVIE_CHART,
  chartToList,
  chartUrl,
} from '../src/engine/online/douban-chart'
import { createOnlineHandlers } from '../src/engine/online'
import { online } from '../src/shared/contract/online'
import type { NetClient } from '../src/shared/net/client'
import { HttpStatusError } from '../src/shared/net/client'

/**
 * 豆瓣一周口碑电影榜（首页榜单行）：rexxar 片单接口 subject_collection_items → 统一卡片，
 * 与浏览共用缓存、熔断和 frodo 回退。夹具按 2026-10 实测的接口结构手写。
 */

const item = (
  rank: number,
  id: string,
  title: string,
  score: number
): Record<string, unknown> => ({
  rank,
  id,
  title,
  type: 'movie',
  card_subtitle: '2025 / 埃及 / 剧情',
  cover_url: `https://img9.doubanio.com/view/photo/m_ratio_poster/public/p${id}.jpg`,
  pic: {
    normal: `https://img9.doubanio.com/view/photo/s_ratio_poster/public/p${id}.jpg`,
    large: '',
  },
  rating: { value: score, count: 1000, max: 10 },
})

const collection = {
  start: 0,
  count: 10,
  total: 10,
  subject_collection_items: [
    item(1, '37322586', '生日快乐', 8.9),
    item(2, '36887293', '登峰传奇：丹增诺盖', 7.7),
    // 片单里偶尔夹着别的卡片：只要影视条目
    { id: '1', type: 'doulist', title: '片单卡' },
  ],
}

function fakeNet(routes: Record<string, unknown>): NetClient & {
  urls: string[]
} {
  const urls: string[] = []
  return {
    urls,
    open: () => Promise.reject(new Error('unused')),
    request: () => Promise.reject(new Error('unused')),
    getText: () => Promise.reject(new Error('unused')),
    async getJson<T>(url: string) {
      urls.push(url)
      const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
      if (!key) throw new HttpStatusError(404)
      const value = routes[key]
      if (value instanceof Error) throw value
      return value as T
    },
  }
}

const REXXAR = `https://m.douban.com/rexxar/api/v2/subject_collection/${WEEKLY_MOVIE_CHART}/items`
const FRODO = `https://frodo.douban.com/api/v2/subject_collection/${WEEKLY_MOVIE_CHART}/items`

describe('chartUrl / chartToList', () => {
  it('取一周口碑电影榜前 10', () => {
    expect(chartUrl()).toBe(`${REXXAR}?start=0&count=10`)
  })

  it('片单外层换成 { items, total }；不是片单原样返回', () => {
    expect(chartToList(collection)).toEqual({
      items: collection.subject_collection_items,
      total: 3,
    })
    expect(chartToList({ msg: 'x' })).toEqual({ msg: 'x' })
  })
})

describe('chart()', () => {
  it('映射成统一卡片（按名次，评分一位小数，年份取副标题），10 分钟内只请求一次', async () => {
    const net = fakeNet({ [REXXAR]: collection })
    const douban = createDoubanBrowse({ net, frodo: false })
    const items = await douban.chart()
    expect(items).toEqual([
      {
        id: '37322586',
        title: '生日快乐',
        cover:
          'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p37322586.jpg',
        rate: '8.9',
        url: 'https://movie.douban.com/subject/37322586/',
        year: '2025',
        kind: 'movie',
      },
      expect.objectContaining({ id: '36887293', rate: '7.7' }),
    ])
    await douban.chart()
    expect(net.urls).toHaveLength(1)
  })

  it('rexxar 失败时换 frodo 签名地址再取（同一形状）', async () => {
    const net = fakeNet({
      [REXXAR]: new HttpStatusError(403),
      [FRODO]: collection,
    })
    const douban = createDoubanBrowse({ net, frodo: true })
    const items = await douban.chart()
    expect(items.map(s => s.id)).toEqual(['37322586', '36887293'])
    expect(net.urls.some(url => url.startsWith(FRODO))).toBe(true)
  })

  it('两边都失败时 reject（首页退回热门列表）', async () => {
    const net = fakeNet({})
    const douban = createDoubanBrowse({ net, frodo: false })
    await expect(douban.chart()).rejects.toThrow()
  })
})

describe('契约与接线', () => {
  it('契约里是无参数调用；在线域 handler 取引擎里的口碑榜', async () => {
    expect(online.calls.doubanChart.parse([])).toEqual([])
    const net = fakeNet({ [REXXAR]: collection })
    const handlers = createOnlineHandlers({
      net,
      loadPlugin: () => Promise.reject(new Error('unused')),
    })
    const items = await handlers.doubanChart({} as never)
    expect(items.map(s => s.title)).toEqual(['生日快乐', '登峰传奇：丹增诺盖'])
  })
})
