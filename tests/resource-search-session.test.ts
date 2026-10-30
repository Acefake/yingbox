// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Ref, effectScope, nextTick, ref } from 'vue'
import type { LibraryItemSummary } from '../src/shared/library/ipc'

const fake = vi.hoisted(() => ({
  query: vi.fn(),
  search: vi.fn(),
  torznab: vi.fn(),
  online: vi.fn(),
  enhance: vi.fn(),
  tmdb: vi.fn(),
}))
vi.mock('@/features/library', () => ({
  searchLibraryBridge: () => ({ query: fake.query }),
  searchLibrary: async () => {},
  fuseSearch: () => [],
  routeSearch: () => ({}),
}))
vi.mock('@/features/netdisk', () => ({
  netdiskAvailable: true,
  netdisk: () => ({ search: fake.search, torznab: fake.torznab }),
}))
vi.mock('@/features/settings', () => ({
  getSetting: () => '',
  settingsReady: Promise.resolve(),
}))
vi.mock('@/features/online', () => ({ tmdb: fake.tmdb }))
vi.mock('../src/renderer/src/features/search/platform', () => ({
  useSearchOnline: () => ({
    available: true,
    search: fake.online,
    open: async () => {},
  }),
  enhanceSearch: fake.enhance,
}))
import { useResourceSearch } from '../src/renderer/src/features/search/use-resource-search'
import {
  enrichResource,
  lookupTitles,
} from '../src/renderer/src/features/search/metadata'
import { parseQuery } from '../src/renderer/src/features/search/rules'
import { localResource } from '../src/renderer/src/features/search/resources'

const item = (id: number, title = '沙丘'): LibraryItemSummary => ({
  id,
  libraryId: 1,
  type: 'movie',
  title,
  originalTitle: null,
  year: 2021,
  matchState: 'auto',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 1,
  updatedAt: 1,
})
const scopes: ReturnType<typeof effectScope>[] = []

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await nextTick()
}

function setup(text = '沙丘'): {
  query: Ref<string>
  state: ReturnType<typeof useResourceSearch>
} {
  const scope = effectScope()
  scopes.push(scope)
  const query = ref(text)
  const state = scope.run(() => useResourceSearch(() => query.value))!
  return { query, state }
}

beforeEach(() => {
  vi.resetAllMocks()
  fake.query.mockResolvedValue({ items: [item(1)], total: 1 })
  fake.search.mockResolvedValue({ ok: true, items: [], magnets: [], notes: [] })
  fake.torznab.mockResolvedValue({
    urls: ['https://fixture.invalid/api'],
    hasKey: true,
  })
  fake.online.mockResolvedValue('')
  fake.enhance.mockResolvedValue({ keywords: [], resources: [], message: '' })
  fake.tmdb.mockResolvedValue(null)
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
})

describe('完整搜索编排', () => {
  it('本地先返回，不等待网盘；超过浮层上限的结果和后续分页均可展示', async () => {
    let finish!: (reply: unknown) => void
    fake.search.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    fake.query.mockResolvedValueOnce({
      items: Array.from({ length: 60 }, (_, i) => item(i + 1, `电影${i}`)),
      total: 75,
    })
    fake.query.mockResolvedValueOnce({
      items: Array.from({ length: 15 }, (_, i) =>
        item(i + 61, `电影${i + 60}`)
      ),
      total: 75,
    })
    const { state } = setup()
    await flush()
    expect(state.resources.value).toHaveLength(60)
    expect(state.busy.value).toBe(true)
    expect(state.more.value).toBe(true)
    await state.loadMore()
    expect(state.resources.value).toHaveLength(75)
    expect(state.more.value).toBe(false)
    expect(fake.query.mock.calls[1][0].offset).toBe(60)
    finish({ ok: true, items: [], magnets: [], notes: [] })
    await flush()
    expect(state.busy.value).toBe(false)
  })
  it('换词之后不接受上一轮迟到的网盘响应', async () => {
    let old!: (reply: unknown) => void
    fake.search.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          old = resolve
        })
    )
    const { state, query } = setup('旧片')
    await flush()
    query.value = '新片'
    await flush()
    old({
      ok: true,
      items: [
        {
          title: '旧片',
          shareCode: 'late',
          receiveCode: '',
          source: 'old',
          url: 'https://115.com/s/late',
        },
      ],
      magnets: [],
      notes: [],
    })
    await flush()
    expect(
      state.resources.value.some(resource => resource.key === 'share:late')
    ).toBe(false)
  })
  it('单独重试在线来源，不重复查询网盘，也不清除本地结果', async () => {
    fake.online.mockRejectedValueOnce(new Error('在线超时'))
    const { state } = setup()
    await flush()
    expect(state.states.value?.online.status).toBe('error')
    await state.retry('online')
    expect(fake.search).toHaveBeenCalledTimes(1)
    expect(fake.online).toHaveBeenCalledTimes(2)
    expect(state.resources.value).toHaveLength(1)
  })
  it('没有配置来源时不给网盘发搜索请求，AI 失败仍保留普通搜索', async () => {
    fake.torznab.mockResolvedValue({ urls: [], hasKey: false })
    fake.enhance.mockRejectedValue(new Error('模型超时'))
    const { state } = setup()
    await flush()
    expect(fake.search).not.toHaveBeenCalled()
    expect(state.states.value?.netdisk.status).toBe('unconfigured')
    expect(state.resources.value).toHaveLength(1)
  })
  it('界面口令不会发给资源源、元数据或模型', async () => {
    setup('getav')
    await flush()
    expect(fake.search).not.toHaveBeenCalled()
    expect(fake.tmdb).not.toHaveBeenCalled()
    expect(fake.enhance).not.toHaveBeenCalled()
  })
})
describe('可信元数据补查', () => {
  it('模糊结果不参与别名扩展，片名与年份精确匹配才补 ID 和原名', async () => {
    fake.tmdb.mockResolvedValue({
      results: [
        {
          id: 1,
          media_type: 'movie',
          title: '沙丘',
          original_title: 'Dune',
          release_date: '2021-01-01',
        },
        {
          id: 2,
          media_type: 'movie',
          title: '沙丘2',
          release_date: '2021-01-01',
        },
        {
          id: 3,
          media_type: 'movie',
          title: '沙丘',
          release_date: '1984-01-01',
        },
      ],
    })
    const titles = await lookupTitles(
      parseQuery('沙丘 2021'),
      new AbortController().signal
    )
    expect(titles).toHaveLength(1)
    expect(enrichResource(localResource(item(1)), titles)).toMatchObject({
      tmdbId: '1',
      aliases: ['沙丘', 'Dune'],
    })
  })
  it('缺少年份和手动拆分条目保留独立身份', () => {
    const titles = [
      {
        id: '1',
        type: 'movie' as const,
        title: '沙丘',
        original: 'Dune',
        year: 2021,
      },
    ]
    const split = localResource({ ...item(1), mergeKey: null })
    expect(enrichResource(split, titles)).toBe(split)
    const unknown = { ...localResource(item(2)), year: undefined }
    expect(enrichResource(unknown, titles)).toBe(unknown)
  })
})
