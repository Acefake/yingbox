import { describe, expect, it, vi } from 'vitest'

import { openLibraryDb } from '../../src/main/library/db/database'
import { DomainRegistry } from '../../src/server/domains/registry'
import type { ServerEngine } from '../../src/server/online/engine'
import { createPlayback, sqliteUserState } from '../../src/server/playback'
import { registerView } from '../../src/server/view'
import type { DoubanMetadata } from '../../src/shared/douban/detail'
import type { DoubanItem } from '../../src/shared/douban/item'

const meta = (id: string): DoubanMetadata => ({
  id,
  kind: 'movie',
  title: `片${id}`,
  originalTitle: '',
  year: '2026',
  genres: [],
  countries: [],
  cardSubtitle: '',
  rating: null,
  cover: 'https://img.doubanio.com/p.jpg',
  intro: '',
  duration: '',
  directors: [],
  actors: [],
  images: [],
  backdrop: '',
})

/** 豆瓣详情慢一点回来，好让两个请求交错 */
function setup(): {
  registry: DomainRegistry
  playback: ReturnType<typeof createPlayback>
  metadata: ReturnType<typeof vi.fn>
} {
  const metadata = vi.fn(
    (id: string) =>
      new Promise(resolve => setTimeout(() => resolve(meta(id)), 5))
  )
  const engine: ServerEngine = {
    invoke: async (channel, args) =>
      channel === 'online:doubanMetadata' ? metadata(args[0] as string) : null,
    subscribe: () => () => {},
    shutdown: async () => {},
  }
  const playback = createPlayback(sqliteUserState(openLibraryDb(':memory:')))
  const registry = new DomainRegistry()
  registerView(registry, engine, playback)
  return { registry, playback, metadata }
}

const favorite = (
  r: DomainRegistry,
  id: string,
  on: boolean
): ReturnType<DomainRegistry['invoke']> =>
  r.invoke('view', 'favorite', [id, 'movie', on])

describe('收藏（view.favorite）', () => {
  it('快速连点两次「收藏」只收藏一次，不会被第二次取消', async () => {
    const { registry, playback } = setup()
    const [a, b] = await Promise.all([
      favorite(registry, '1', true),
      favorite(registry, '1', true),
    ])
    expect([a, b]).toEqual([
      { ok: true, value: true },
      { ok: true, value: true },
    ])
    expect(playback.favorites()).toHaveLength(1)
  })

  it('取消收藏不取豆瓣详情；旧格式的豆瓣地址也按 ID 认出来', async () => {
    const { registry, playback, metadata } = setup()
    const legacy: DoubanItem = {
      ...{
        title: '旧',
        searchTitle: '旧',
        original_title: '',
        cover: '',
        coverSrc: '',
        rate: '暂无',
        year: '',
        type: '电影',
        overview: '',
      },
      url: 'https://m.douban.com/movie/subject/2',
    }
    playback.toggleFavorite(legacy)

    expect(
      await registry.invoke('view', 'detail', ['2', 'movie'])
    ).toMatchObject({ ok: true, value: { favorite: true } })
    metadata.mockClear()
    expect(await favorite(registry, '2', false)).toEqual({
      ok: true,
      value: false,
    })
    expect(metadata).not.toHaveBeenCalled()
    expect(playback.favorites()).toEqual([])
  })

  it('已收藏再收藏直接返回，不重复添加', async () => {
    const { registry, playback, metadata } = setup()
    await favorite(registry, '3', true)
    metadata.mockClear()
    expect(await favorite(registry, '3', true)).toEqual({
      ok: true,
      value: true,
    })
    expect(metadata).not.toHaveBeenCalled()
    expect(playback.favorites()).toHaveLength(1)
  })

  it('收藏页与最近播放页返回全部记录', async () => {
    const { registry, playback } = setup()
    await favorite(registry, '4', true)
    await favorite(registry, '5', true)
    playback.continueStart(
      { section: 'online', key: '片', title: '片' },
      { url: 'https://v.example.com/1.m3u8' },
      0
    )
    expect(await registry.invoke('view', 'favorites', [])).toMatchObject({
      ok: true,
      value: [{ id: '5' }, { id: '4' }],
    })
    expect(await registry.invoke('view', 'recent', [])).toMatchObject({
      ok: true,
      value: [{ id: 'online:片', title: '片' }],
    })
  })

  it('最近播放的在线记录按豆瓣 ID 补竖版海报，取不到时为 null', async () => {
    const { registry, playback } = setup()
    playback.continueStart(
      {
        section: 'online',
        key: '甲',
        title: '甲',
        detail: { doubanId: '7', kind: 'movie' },
      },
      { url: 'https://v.example.com/1.m3u8' },
      0
    )
    playback.continueStart(
      { section: 'online', key: '乙', title: '乙' },
      { url: 'https://v.example.com/2.m3u8' },
      0
    )
    const result = await registry.invoke('view', 'recent', [])
    expect(result).toMatchObject({ ok: true })
    const cards = (
      result as { value: { title: string; poster: string | null }[] }
    ).value
    const posterOf = (title: string): string | null | undefined =>
      cards.find(card => card.title === title)?.poster
    expect(posterOf('甲')).toMatch(/^\/media\/thumb\?/)
    expect(posterOf('乙')).toBeNull()
  })
})
