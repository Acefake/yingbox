// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { readFileSync } from 'node:fs'
import { h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type DoubanPage,
  type DoubanQuery,
  type DoubanSubject,
  defaultDoubanQuery,
} from '../src/shared/douban/query'
import { isAtEnd } from '@/components/ui/virtual-range'
import type { BrowseTarget } from '@/features/online/utils/browse-target'

/**
 * 豆瓣浏览（渲染层）：筛选条件 → 分页加载 / 去重 / 失败重试 / 换条件丢弃过期结果 / 会话级记住条件，
 * 以及带数据的浏览页 DoubanBrowse 渲染（卡片接上悬停预览、加载更多的三点、失败的重试按钮、筛选胶囊与已选条件）。
 * 网络全部替换：引擎接口 doubanBrowse 用夹具页，TMDB 无令牌。
 */

// 渲染层模块读 localStorage / sessionStorage（收藏、筛选条件），Node 里给内存版
const makeStorage = (): Storage => {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}
vi.stubGlobal('localStorage', makeStorage())
vi.stubGlobal('sessionStorage', makeStorage())

const subject = (
  id: number,
  kind: 'movie' | 'tv' = 'movie'
): DoubanSubject => ({
  id: String(id),
  title: `片${id}`,
  cover: `https://img1.doubanio.com/p${id}.jpg`,
  rate: '8.0',
  url: `https://movie.douban.com/subject/${id}/`,
  year: '2024',
  kind,
})
const pageOf = (ids: number[], next: number | null): DoubanPage => ({
  items: ids.map(id => subject(id)),
  next,
})

// 引擎接口：doubanBrowse 由各用例设定；TMDB 没有令牌
const api = vi.hoisted(() => ({
  doubanBrowse: vi.fn(),
  doubanTrailer: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('@/features/online/api/online', () => ({
  doubanBrowse: api.doubanBrowse,
  getJson: vi.fn(() => new Promise(() => {})),
  tmdb: vi.fn(() => Promise.resolve(null)),
  doubanMetadata: vi.fn(async () => null),
  onlineApi: () => ({ doubanTrailer: api.doubanTrailer }),
}))

const HOT: BrowseTarget = { type: 'hot', kind: 'movie' }
const COMEDY: BrowseTarget = { type: 'genre', genre: '喜剧', kind: 'movie' }

const { createDoubanFeed, useDoubanFeed } =
  await import('@/features/online/composables/use-douban-feed')

/** 可控的分页：每次调用返回一个等待 resolve 的承诺 */
function deferredBrowse(): {
  browse: (q: DoubanQuery, start: number) => Promise<DoubanPage>
  calls: Array<{
    query: DoubanQuery
    start: number
    resolve: (p: DoubanPage) => void
    reject: (e: Error) => void
  }>
} {
  const calls: ReturnType<typeof deferredBrowse>['calls'] = []
  return {
    calls,
    browse: (query, start) =>
      new Promise<DoubanPage>((resolve, reject) =>
        calls.push({ query, start, resolve, reject })
      ),
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('分页加载', () => {
  it('首屏取 start=0；末尾再取下一页并追加；next 为空即到底，不再请求', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    expect(feed.status.value).toBe('idle')
    void feed.start()
    expect(feed.status.value).toBe('loading')
    expect(net.calls[0].start).toBe(0)
    net.calls[0].resolve(pageOf([1, 2], 20))
    await flush()
    expect(feed.items.value.map(i => i.title)).toEqual(['片1', '片2'])
    expect(feed.status.value).toBe('ready')

    void feed.loadMore()
    void feed.loadMore() // 加载中重复触发不发第二个请求
    expect(net.calls).toHaveLength(2)
    expect(net.calls[1].start).toBe(20)
    net.calls[1].resolve(pageOf([3], null))
    await flush()
    expect(feed.items.value.map(i => i.title)).toEqual(['片1', '片2', '片3'])
    expect(feed.status.value).toBe('ended')
    await feed.loadMore()
    expect(net.calls).toHaveLength(2)
  })

  it('去重：跨页重复的条目只留第一次；整页都是重复时自动接着取下一页', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.start()
    net.calls[0].resolve(pageOf([1, 2], 20))
    await flush()
    void feed.loadMore()
    net.calls[1].resolve(pageOf([2, 1], 40))
    await flush()
    expect(net.calls).toHaveLength(3)
    expect(net.calls[2].start).toBe(40)
    net.calls[2].resolve(pageOf([2, 4], 60))
    await flush()
    expect(feed.items.value.map(i => i.url)).toEqual([
      'https://movie.douban.com/subject/1/',
      'https://movie.douban.com/subject/2/',
      'https://movie.douban.com/subject/4/',
    ])
  })

  it('失败：保留已有内容、状态 error、不自动重试；retry 从失败的那页接着取', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.start()
    net.calls[0].resolve(pageOf([1], 20))
    await flush()
    void feed.loadMore()
    net.calls[1].reject(new Error('302'))
    await flush()
    expect(feed.status.value).toBe('error')
    expect(feed.items.value).toHaveLength(1)
    await feed.loadMore()
    expect(net.calls).toHaveLength(2)
    void feed.retry()
    expect(net.calls[2].start).toBe(20)
    net.calls[2].resolve(pageOf([2], null))
    await flush()
    expect(feed.items.value).toHaveLength(2)
    expect(feed.status.value).toBe('ended')
  })

  it('卡片保留原有字段（收藏、详情、预告片要用），评分缺失显示「暂无」', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.start()
    net.calls[0].resolve({
      items: [{ ...subject(9, 'tv'), rate: '', year: '' }],
      next: null,
    })
    await flush()
    expect(feed.items.value[0]).toMatchObject({
      title: '片9',
      searchTitle: '片9',
      coverSrc: 'https://img1.doubanio.com/p9.jpg',
      rate: '暂无',
      url: 'https://movie.douban.com/subject/9/',
      kind: 'tv',
    })
  })
})

describe('换条件', () => {
  it('换条件后从第 0 条重取；新一批到达前保留旧内容；过期的旧请求结果丢弃', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.start()
    net.calls[0].resolve(pageOf([1, 2], 20))
    await flush()
    void feed.loadMore() // 旧条件的第二页还没回来
    void feed.setQuery({ genre: '喜剧' })
    expect(feed.query.value.genre).toBe('喜剧')
    expect(feed.query.value.tag).toBe('')
    expect(net.calls[2].start).toBe(0)
    expect(net.calls[2].query.genre).toBe('喜剧')
    expect(feed.items.value.map(i => i.title)).toEqual(['片1', '片2'])
    net.calls[1].resolve(pageOf([50], 40)) // 旧条件的结果晚到
    await flush()
    expect(feed.items.value.map(i => i.title)).toEqual(['片1', '片2'])
    net.calls[2].resolve(pageOf([7], null))
    await flush()
    expect(feed.items.value.map(i => i.title)).toEqual(['片7'])
    expect(feed.status.value).toBe('ended')
  })

  it('点快捷标签清空多维筛选；切电影 / 电视剧回到该类型的默认条件', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.setQuery({ genre: '喜剧', sort: 'S' })
    void feed.setQuery({ tag: '华语' })
    expect(feed.query.value).toEqual({
      ...defaultDoubanQuery('movie'),
      tag: '华语',
    })
    void feed.setQuery({ kind: 'tv' })
    expect(feed.query.value).toEqual(defaultDoubanQuery('tv'))
  })

  it('跨分类选择标签只请求一次并保留目标标签', () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.setQuery({ kind: 'tv', tag: '日本动画' })
    expect(feed.query.value).toEqual({
      ...defaultDoubanQuery('tv'),
      tag: '日本动画',
    })
    expect(net.calls).toHaveLength(1)
  })

  it('条件没变不重取', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    void feed.start()
    void feed.setQuery({ tag: '热门' })
    expect(net.calls).toHaveLength(1)
  })
})

describe('记住条件（会话级）', () => {
  it('条件写入 sessionStorage；新建时读回（按白名单收），坏数据退回默认', async () => {
    const net = deferredBrowse()
    const a = createDoubanFeed({ browse: net.browse, storage: sessionStorage })
    void a.setQuery({ kind: 'tv' })
    void a.setQuery({ region: '韩国', minRating: 8 })
    const b = createDoubanFeed({ browse: net.browse, storage: sessionStorage })
    expect(b.query.value).toEqual({
      ...defaultDoubanQuery('tv'),
      tag: '',
      region: '韩国',
      minRating: 8,
    })
    sessionStorage.setItem('douban_query', '{"kind":"tv","genre":"<x>"')
    const c = createDoubanFeed({ browse: net.browse, storage: sessionStorage })
    expect(c.query.value).toEqual(defaultDoubanQuery('movie'))
  })
})

describe('末尾触发', () => {
  it('量好行距后，渲染区间到了最后一条才算到底', () => {
    const range = { start: 0, end: 20, padTop: 0, padBottom: 0 }
    expect(isAtEnd(range, 20, 300)).toBe(true)
    expect(isAtEnd({ ...range, end: 16 }, 20, 300)).toBe(false)
    // 还没量到行距（首帧先渲染一批）不算；空列表不算
    expect(isAtEnd(range, 20, 0)).toBe(false)
    expect(isAtEnd({ ...range, end: 0 }, 0, 300)).toBe(false)
  })

  it('UiVirtualGrid 到底时发 reach-end，DoubanBrowse 接到加载更多', () => {
    const grid = readFileSync(
      'src/renderer/src/components/ui/UiVirtualGrid.vue',
      'utf8'
    )
    expect(grid).toMatch(/emit\('reach-end'\)/)
    const section = readFileSync(
      'src/renderer/src/features/online/components/DoubanBrowse.vue',
      'utf8'
    )
    expect(section).toMatch(/@reach-end="feed\.loadMore"/)
  })
})

describe('离开在线页再回来', () => {
  it('滚动时把滚动容器位置记进 feed、停用期间不记，切回 / 重新挂载时写回（条件与列表在模块级的 feed 里，不随组件重建丢）', () => {
    const section = readFileSync(
      'src/renderer/src/features/online/components/DoubanBrowse.vue',
      'utf8'
    )
    expect(section).toMatch(/feed\.scrollTop = scrollEl\.scrollTop/)
    expect(section).toMatch(/addEventListener\('scroll', rememberScroll/)
    expect(section).toMatch(/onDeactivated\(\(\) => \(tracking = false\)\)/)
    expect(section).toMatch(/onActivated\(restoreScroll\)/)
    expect(section).toMatch(/scrollEl\.scrollTop = feed\.scrollTop/)
    expect(useDoubanFeed()).toBe(useDoubanFeed())
  })
})

describe('DoubanBrowse 带数据渲染', () => {
  const feed = useDoubanFeed()
  const render = async (target: BrowseTarget = HOT): Promise<string> => {
    const { default: DoubanBrowse } =
      await import('@/features/online/components/DoubanBrowse.vue')
    return renderToString(h(DoubanBrowse, { target }))
  }
  const count = (html: string, needle: string): number =>
    html.split(needle).length - 1

  afterEach(async () => {
    api.doubanBrowse.mockReset()
    await feed.setQuery(defaultDoubanQuery('movie'))
  })

  it('每张豆瓣卡都接上悬停预览（预览层）；筛选胶囊在、默认没有已选条件', async () => {
    api.doubanBrowse.mockResolvedValue(pageOf([11, 12, 13], 20))
    await feed.reload()
    await nextTick()
    const html = await render()
    expect(api.doubanBrowse).toHaveBeenCalledWith(
      defaultDoubanQuery('movie'),
      0
    )
    expect(count(html, 'class="ui-poster ')).toBe(3)
    expect(count(html, 'ui-preview-layer')).toBe(3)
    expect(html).toContain('片12')
    expect(html).toContain('全部')
    expect(html).toContain('排序 · 综合')
    expect(html).toContain('地区')
    expect(html).not.toContain('清除')
    expect(html).not.toContain('ui-loading-dots')
  })

  it('类型页：选中的筛选写在胶囊里并出 chip + 清除；加载下一页时网格之后是三点；失败给重试按钮', async () => {
    api.doubanBrowse.mockResolvedValueOnce(pageOf([21, 22], 20))
    await feed.replaceQuery({
      ...defaultDoubanQuery('movie'),
      tag: '',
      genre: '喜剧',
      region: '欧美',
    })
    let release: (p: DoubanPage) => void = () => {}
    api.doubanBrowse.mockReturnValueOnce(
      new Promise<DoubanPage>(r => (release = r))
    )
    void feed.loadMore()
    const loading = await render(COMEDY)
    expect(loading).toContain('喜剧')
    expect(loading).toContain('地区 · 欧美')
    expect(loading).toContain('去掉条件：欧美')
    expect(loading).toContain('清除')
    for (const label of ['年代', '排序', '评分'])
      expect(loading).toContain(label)
    expect(count(loading, 'ui-preview-layer')).toBe(2)
    expect(loading).toContain('ui-loading-dots')
    expect(loading.indexOf('ui-loading-dots')).toBeGreaterThan(
      loading.lastIndexOf('ui-preview-layer')
    )
    release(pageOf([23], 40))
    await flush()

    api.doubanBrowse.mockRejectedValueOnce(new Error('302'))
    await feed.loadMore()
    await flush()
    const failed = await render(COMEDY)
    expect(failed).toContain('重试')
    expect(count(failed, 'ui-preview-layer')).toBe(3)
  })
})

describe('整组换条件 / 初始条件', () => {
  it('replaceQuery 整个换掉条件（类型 + 地区同时生效，不被快捷标签逻辑清掉）；相同条件不重取', async () => {
    const net = deferredBrowse()
    const feed = createDoubanFeed({ browse: net.browse, storage: null })
    const next = {
      ...defaultDoubanQuery('tv'),
      tag: '',
      genre: '悬疑',
      region: '韩国',
    }
    void feed.replaceQuery(next)
    expect(net.calls[0].query).toEqual(next)
    net.calls[0].resolve(pageOf([1], null))
    await flush()
    await feed.replaceQuery({ ...next })
    expect(net.calls).toHaveLength(1)
  })

  it('initial 决定没有记住条件时的起点（首页热门剧集货架）', () => {
    const feed = createDoubanFeed({
      browse: deferredBrowse().browse,
      storage: null,
      initial: defaultDoubanQuery('tv'),
    })
    expect(feed.query.value).toEqual(defaultDoubanQuery('tv'))
  })
})
