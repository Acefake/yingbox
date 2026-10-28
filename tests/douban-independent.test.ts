import { describe, expect, it, vi } from 'vitest'
import { doubanItemOf } from '@/features/online/composables/use-douban-feed'
import { enrichDoubanItems } from '@/features/online/utils/douban-enrich'
import { enrichFromTmdb } from '@/features/online/utils/douban-tmdb'
import { doubanDetail } from '@/features/online/utils/douban-detail'
import { parseDoubanMetadata } from '../src/engine/online/douban-metadata'
import type { DoubanMetadata } from '../src/shared/douban/detail'
import type { DoubanItem } from '@/features/online/types'

const card = (): DoubanItem =>
  doubanItemOf({
    id: '1',
    title: '片名',
    cover: 'https://img1.doubanio.com/poster.jpg',
    rate: '8.5',
    url: 'https://movie.douban.com/subject/1/',
    year: '2024',
    kind: 'tv',
  })
const metadata = (): DoubanMetadata => ({
  ...parseDoubanMetadata({
    id: '1',
    title: '片名',
    intro: '豆瓣简介',
    year: '2024',
  })!,
  backdrop: 'https://img1.doubanio.com/scene.jpg',
})

describe('无 TMDB 的首页', () => {
  it('首屏无需等待补全就有封面、年份、类型和评分', () => {
    expect(card()).toMatchObject({
      cover: 'https://img1.doubanio.com/poster.jpg',
      year: '2024',
      type: '剧集',
      rate: '8.5',
    })
  })
  it('无令牌和请求失败均保留豆瓣简介及背景图', async () => {
    for (const tmdb of [
      vi.fn(async () => null),
      vi.fn(async () => {
        throw new Error('offline')
      }),
    ]) {
      const items = [card()]
      await enrichDoubanItems(items, 'tv', {
        metadata: vi.fn(async () => metadata()),
        tmdb: (values, kind) => enrichFromTmdb(values, kind, tmdb),
      })
      expect(items[0]).toMatchObject({
        overview: '豆瓣简介',
        backdrop: metadata().backdrop,
        rate: '8.5',
        type: '剧集',
      })
      expect(doubanDetail(items[0])).toMatchObject({
        doubanKind: 'tv',
        doubanRating: '8.5',
        backdrop: metadata().backdrop,
        vod_pic: card().cover,
      })
    }
  })
  it('仅补首屏五项，详情失败不影响列表', async () => {
    const get = vi.fn(async () => {
      throw new Error('offline')
    })
    const items = Array.from({ length: 20 }, card)
    await enrichDoubanItems(items, 'tv', {
      metadata: get,
      tmdb: async () => {},
    })
    expect(get).toHaveBeenCalledTimes(5)
    expect(items.every(item => item.cover && item.type)).toBe(true)
  })
})
