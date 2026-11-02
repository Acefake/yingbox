import { describe, expect, it, vi } from 'vitest'

import { COLLECTIONS, HOME_GENRES } from '../../src/shared/douban/collections'
import type {
  DoubanKind,
  DoubanQuery,
  DoubanSubject,
} from '../../src/shared/douban/query'
import { parseDoubanMetadata } from '../../src/engine/online/douban-metadata'
import { toMediaUrl } from '../../src/server/routes/media'
import { type HomeDeps, buildHomeFeed } from '../../src/server/view/home'
import { parseMediaUrl } from '../../src/shared/media-url'
import { cachedHome, engineHomeDeps } from '../../src/server/view'
import type { ServerEngine } from '../../src/server/online/engine'

const subject = (id: string, kind: DoubanKind = 'movie'): DoubanSubject => ({
  id,
  title: `片${id}`,
  cover: `https://img1.doubanio.com/view/${id}.jpg`,
  rate: id === '2' ? '' : '8.1',
  url: `https://movie.douban.com/subject/${id}/`,
  year: '2024',
  kind,
})

/** 视图里的图片路径交给服务端缩略图路由时能被接受（宽度是合法档位），返回原图地址 */
function thumbSource(path: string): string | null {
  const media = toMediaUrl(new URL(path, 'http://127.0.0.1'))
  const target = media ? parseMediaUrl(media) : null
  return target?.kind === 'thumb' ? target.source : null
}

/** 默认：豆瓣都有数据，TMDB 没有令牌，豆瓣详情取不到 */
function deps(overrides: Partial<HomeDeps> = {}): HomeDeps {
  return {
    browse: vi.fn(async (query: DoubanQuery) => ({
      items: [1, 2, 3, 4].map(n =>
        subject(
          `${query.kind === 'tv' ? 2 : 1}${query.tag.length}${n}`,
          query.kind
        )
      ),
      next: 20,
    })),
    chart: vi.fn(async () => [subject('901'), subject('902')]),
    metadata: vi.fn(async () => null),
    search: vi.fn(async () => null),
    ...overrides,
  }
}

describe('view.home 拼装（ADR-0030）', () => {
  it('热门两行、口碑榜、类型和片单都在，图片换成本服务缩略图', async () => {
    const home = await buildHomeFeed(deps())

    expect(home.hotMovies?.title).toBe('热门电影')
    expect(home.hotTv?.title).toBe('热门剧集')
    expect(home.hotTv?.items[0].kind).toBe('tv')
    expect(home.chart?.title).toBe('豆瓣本周口碑榜')
    expect(home.chart?.items.map(c => c.id)).toEqual(['901', '902'])
    expect(home.genres).toEqual(HOME_GENRES)
    expect(home.collections.map(c => c.id)).toEqual(COLLECTIONS.map(c => c.id))
    expect(home.collections[0].posters).toHaveLength(3)

    const card = home.chart!.items[0]
    expect(thumbSource(card.poster)).toBe(
      'https://img1.doubanio.com/view/901.jpg'
    )
    expect(card.backdrop).toBeNull()
    expect(card.doubanUrl).toBe('https://movie.douban.com/subject/901/')
  })

  it('无评分写空串，不把「暂无」交给客户端', async () => {
    const home = await buildHomeFeed(
      deps({ chart: vi.fn(async () => [subject('2')]) })
    )
    expect(home.chart?.items[0].rate).toBe('')
  })

  it('豆瓣详情补到的剧照、简介进卡片', async () => {
    const home = await buildHomeFeed(
      deps({
        chart: vi.fn(async () => [subject('901')]),
        metadata: vi.fn(async () => ({
          ...parseDoubanMetadata({ id: '901', title: '片901', intro: '简介' })!,
          backdrop: 'https://img1.doubanio.com/scene.jpg',
        })),
      })
    )
    const card = home.chart!.items[0]
    expect(card.overview).toBe('简介')
    expect(thumbSource(card.backdrop!)).toBe(
      'https://img1.doubanio.com/scene.jpg'
    )
  })

  it('口碑榜失败时退回热门电影前 10，标题跟着变', async () => {
    const home = await buildHomeFeed(
      deps({
        chart: vi.fn(async () => {
          throw new Error('熔断')
        }),
      })
    )
    expect(home.chart?.title).toBe('豆瓣热门 Top 10')
  })

  it('某一行失败只省略那一行，其余照常返回', async () => {
    const browse = vi.fn(async (query: DoubanQuery) => {
      if (query.kind === 'tv') throw new Error('豆瓣超时')
      return { items: [subject('101')], next: null }
    })
    const home = await buildHomeFeed(deps({ browse }))

    expect(home.hotTv).toBeNull()
    expect(home.hotMovies?.items).toHaveLength(1)
    expect(home.collections.find(c => c.id === 'kdrama')?.posters).toEqual([])
  })

  it('豆瓣全挂时仍返回首页骨架', async () => {
    const fail = vi.fn(async () => {
      throw new Error('offline')
    })
    const home = await buildHomeFeed(deps({ browse: fail, chart: fail }))
    expect(home).toMatchObject({ hotMovies: null, hotTv: null, chart: null })
    expect(home.genres).toEqual(HOME_GENRES)
    expect(home.collections.every(c => c.posters.length === 0)).toBe(true)
  })
})

describe('首页缓存', () => {
  it('10 分钟内复用结果，并发请求只拼一次，过期后重拼', async () => {
    let now = 0
    const build = vi.fn(async () => buildHomeFeed(deps()))
    const home = cachedHome(build, () => now)

    const [a, b] = await Promise.all([home(), home()])
    expect(a).toBe(b)
    now = 9 * 60 * 1000
    await home()
    expect(build).toHaveBeenCalledTimes(1)
    now = 11 * 60 * 1000
    await home()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('有行没取到时只缓存 30 秒，网络恢复后很快补上', async () => {
    let now = 0
    let fail = true
    const build = vi.fn(async () =>
      buildHomeFeed(
        fail
          ? deps({
              chart: vi.fn(async () => {
                throw new Error('熔断')
              }),
              browse: vi.fn(async () => {
                throw new Error('熔断')
              }),
            })
          : deps()
      )
    )
    const home = cachedHome(build, () => now)
    expect((await home()).hotMovies).toBeNull()
    fail = false
    now = 20 * 1000
    expect((await home()).hotMovies).toBeNull()
    now = 31 * 1000
    expect((await home()).hotMovies).not.toBeNull()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('拼失败不缓存，下次重试', async () => {
    const build = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async () => buildHomeFeed(deps()))
    const home = cachedHome(build)
    await expect(home()).rejects.toThrow('boom')
    await expect(home()).resolves.toMatchObject({ genres: HOME_GENRES })
  })
})

/** 精选片单的查询（快捷标签是片单的 tag） */
const isCollection = (query: DoubanQuery): boolean =>
  COLLECTIONS.some(c => c.tag === query.tag)

describe('view.home 失败隔离与去重', () => {
  it('取数函数同步抛错也只省略受影响的行', async () => {
    const browse = vi.fn((query: DoubanQuery) => {
      if (isCollection(query)) throw new Error('同步抛错')
      return Promise.resolve({
        items: [subject('101', query.kind)],
        next: null,
      })
    })
    const home = await buildHomeFeed(deps({ browse }))
    expect(home.hotMovies?.items).toHaveLength(1)
    expect(home.collections.every(c => c.posters.length === 0)).toBe(true)
  })

  it('同一行里重复的条目只留一张（客户端用 id 作列表 key）', async () => {
    const home = await buildHomeFeed(
      deps({
        chart: vi.fn(async () => [
          subject('901'),
          subject('901'),
          subject('902'),
        ]),
      })
    )
    expect(home.chart?.items.map(c => c.id)).toEqual(['901', '902'])
  })

  it('片单海报不取豆瓣详情', async () => {
    const metadata = vi.fn(async () => null)
    await buildHomeFeed(
      deps({
        metadata,
        browse: vi.fn(async (query: DoubanQuery) =>
          isCollection(query)
            ? { items: [subject('301'), subject('302')], next: null }
            : { items: [], next: null }
        ),
        chart: vi.fn(async () => []),
      })
    )
    expect(metadata).not.toHaveBeenCalled()
  })
})

describe('引擎取数', () => {
  it('按 online 契约的通道名和参数顺序调用引擎', async () => {
    const invoke = vi.fn(async () => null)
    const engine: ServerEngine = {
      invoke,
      subscribe: () => () => {},
      shutdown: async () => {},
    }
    const d = engineHomeDeps(engine)
    const query = { kind: 'movie' } as DoubanQuery
    await d.browse(query, 20)
    await d.chart()
    await d.metadata('123', 'tv')
    await d.search('/search/movie', { query: '片名', page: 1 })
    expect(invoke.mock.calls).toEqual([
      ['online:doubanBrowse', [query, 20]],
      ['online:doubanChart', []],
      ['online:doubanMetadata', ['123', 'tv']],
      ['online:tmdb', ['/search/movie', { query: '片名', page: 1 }]],
    ])
  })
})
