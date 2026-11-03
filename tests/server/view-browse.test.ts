import { describe, expect, it, vi } from 'vitest'

import { DomainRegistry } from '../../src/server/domains/registry'
import { browsePage } from '../../src/server/view/browse'
import type { HomeDeps } from '../../src/server/view/home'
import { view } from '../../src/shared/contract/view'
import type {
  DoubanPage,
  DoubanQuery,
  DoubanSubject,
} from '../../src/shared/douban/query'

const subject = (id: string): DoubanSubject => ({
  id,
  title: `片${id}`,
  cover: `https://img1.doubanio.com/view/${id}.jpg`,
  rate: '7.0',
  url: `https://movie.douban.com/subject/${id}/`,
  year: '2025',
  kind: 'tv',
})

function deps(pages: DoubanPage[]): HomeDeps & { queries: DoubanQuery[] } {
  const queries: DoubanQuery[] = []
  let n = 0
  return {
    queries,
    browse: vi.fn(async (query: DoubanQuery) => {
      queries.push(query)
      return pages[n++] ?? { items: [], next: null }
    }),
    chart: vi.fn(async () => []),
    metadata: vi.fn(async () => null),
    search: vi.fn(async () => null),
  }
}

describe('浏览页（view.browse）', () => {
  it('类型页按类型查、标题是类型名，卡片补全后带下一页位置', async () => {
    const d = deps([{ items: [subject('1'), subject('2')], next: 20 }])
    const page = await browsePage(
      { type: 'genre', genre: '悬疑', kind: 'tv' },
      0,
      d
    )
    expect(page.title).toBe('悬疑')
    expect(page.items.map(c => c.id)).toEqual(['1', '2'])
    expect(page.next).toBe(20)
    expect(d.queries[0]).toMatchObject({ kind: 'tv', genre: '悬疑' })
  })

  it('片单页用片单的快捷标签和类型', async () => {
    const d = deps([{ items: [subject('3')], next: null }])
    const page = await browsePage({ type: 'list', list: 'kdrama' }, 0, d)
    expect(page.title).toBe('韩剧热播')
    expect(d.queries[0]).toMatchObject({ kind: 'tv', tag: '韩剧' })
  })

  it('空页最多连取 3 页，再空就交回下一页位置让客户端接着翻', async () => {
    const empty = (next: number): DoubanPage => ({ items: [], next })
    const d = deps([
      empty(20),
      empty(40),
      empty(60),
      { items: [subject('9')], next: 80 },
    ])
    const page = await browsePage({ type: 'hot', kind: 'movie' }, 0, d)
    expect(page).toMatchObject({ title: '全部', items: [], next: 60 })
    expect(d.browse).toHaveBeenCalledTimes(3)
  })

  it('契约拒绝不认识的片单、类型缺名字、超出范围的位置', async () => {
    const registry = new DomainRegistry()
    registry.implement(view, {
      home: async () => {
        throw new Error('unused')
      },
      recent: () => [],
      favorites: () => [],
      browse: async () => ({ title: '', items: [], next: null }),
      detail: async () => null,
      favorite: async () => false,
      sourcesStart: () => ({ sessionId: 'x', done: true, sites: [] }),
      sources: () => null,
      resume: () => null,
      resolve: async () => ({ url: '', direct: false, hls: false }),
    })
    for (const args of [
      [{ type: 'list', list: 'nope' }, 0],
      [{ type: 'genre', kind: 'movie' }, 0],
      [{ type: 'hot', kind: 'movie' }, 99999],
    ])
      expect(await registry.invoke('view', 'browse', args)).toMatchObject({
        ok: false,
      })
    expect(
      await registry.invoke('view', 'browse', [{ type: 'hot', kind: 'tv' }, 0])
    ).toMatchObject({ ok: true })
  })
})
