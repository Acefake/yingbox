/**
 * 媒体库自然语言搜索：走 AI 的判定、模型输出清洗、条件 → 引擎查询映射、条件胶囊的删改，
 * 以及 useNlSearch 的调用流程（AI 用 mock：缓存、private、未配置 / 失败退回片名搜索）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'

import {
  NL_FILTER_SCHEMA,
  sanitizeNlFilter,
} from '../src/renderer/src/features/library/nl-search/nl-filter'
import { aiConfigured } from '../src/renderer/src/features/ai/ready'
import {
  NlCache,
  applyNlFilter,
  cacheKey,
  looksNatural,
  nlIntent,
  resolveGenre,
} from '../src/renderer/src/features/library/nl-search/nl-rules'
import {
  type NlChip,
  countryCode,
  editChip,
  nlChips,
  parseYears,
  removeChip,
  toggleChip,
} from '../src/renderer/src/features/library/nl-search/nl-chips'

import type { NlSearch } from '../src/renderer/src/features/library/nl-search/use-nl-search'

describe('是否走 AI', () => {
  it('像一句描述的走 AI，片名关键词走普通搜索', () => {
    for (const text of [
      '90 年代评分 8 分以上的科幻片',
      '没看过的韩剧',
      '诺兰的电影',
      '评分高的喜剧',
      'sci-fi movies from the 90s',
      '2010 年以后的动画',
    ])
      expect(looksNatural(text), text).toBe(true)
    for (const text of [
      '星际穿越',
      '我的父亲母亲',
      '海上钢琴师的传奇',
      '星球大战 2',
      '美国队长',
      '爱情公寓',
      'Inception',
    ])
      expect(looksNatural(text), text).toBe(false)
  })

  it('? 前缀与「AI 理解」按钮强制走 AI；空输入不搜', () => {
    expect(nlIntent('')).toEqual({ kind: 'none' })
    expect(nlIntent('  ?  ')).toEqual({ kind: 'none' })
    expect(nlIntent('星际穿越')).toEqual({ kind: 'plain', text: '星际穿越' })
    expect(nlIntent('?星际穿越')).toEqual({
      kind: 'ai',
      question: '星际穿越',
      forced: true,
    })
    expect(nlIntent('？ 好看的')).toMatchObject({
      kind: 'ai',
      question: '好看的',
    })
    expect(nlIntent('星际穿越', true)).toMatchObject({
      kind: 'ai',
      forced: true,
    })
    expect(nlIntent('没看过的韩剧')).toMatchObject({
      kind: 'ai',
      forced: false,
    })
  })

  it('缓存键按分区区分、忽略大小写与多余空白；缓存超限淘汰最久没用的', () => {
    expect(cacheKey('movie', '  Nolan   的电影 ')).toBe(
      cacheKey('movie', 'nolan 的电影')
    )
    expect(cacheKey('movie', 'a')).not.toBe(cacheKey('tv', 'a'))
    const cache = new NlCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })
})

describe('模型输出清洗', () => {
  it('schema 每个字段都 required（json_schema strict 要求）', () => {
    const schema = NL_FILTER_SCHEMA as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect([...schema.required].sort()).toEqual(
      Object.keys(schema.properties).sort()
    )
  })

  it('只留认识的字段，夹紧范围、对调年份、去重，null / 空数组不出现', () => {
    expect(
      sanitizeNlFilter({
        type: 'series',
        genres: [' 科幻 ', '科幻', 3],
        yearFrom: 1999,
        yearTo: 1990,
        ratingMin: 12,
        people: [],
        countries: ['kr', 'Korea', 'KR'],
        watched: false,
        sort: 'rating',
        order: null,
        keywords: ['星', '球'],
        extra: 'x',
      })
    ).toEqual({
      type: 'series',
      genres: ['科幻'],
      yearFrom: 1990,
      yearTo: 1999,
      ratingMin: 10,
      countries: ['KR'],
      watched: false,
      sort: { field: 'rating', order: 'desc' },
      keywords: ['星'],
    })
    expect(sanitizeNlFilter(null)).toEqual({})
    expect(sanitizeNlFilter([1])).toEqual({})
    expect(
      sanitizeNlFilter({ type: 'tv', yearFrom: 3000, ratingMin: 0, sort: 'x' })
    ).toEqual({})
    expect(sanitizeNlFilter({ sort: 'title' })).toEqual({
      sort: { field: 'title', order: 'asc' },
    })
  })
})

describe('条件 → 引擎查询', () => {
  const base = {
    types: ['movie' as const],
    source: 'tmdb' as const,
    sort: 'addedAt' as const,
    order: 'desc' as const,
    search: '原句',
  }

  it('各字段映射到 LibraryQuery，类型名对齐本库取值', () => {
    const query = applyNlFilter(
      base,
      {
        genres: ['科幻'],
        yearFrom: 1990,
        yearTo: 1999,
        ratingMin: 8,
        people: ['诺兰'],
        countries: ['US'],
        sort: { field: 'rating', order: 'desc' },
      },
      { section: 'movie', genres: ['剧情', '科幻'], watchedIds: [] }
    )
    expect(query).toEqual({
      types: ['movie'],
      source: 'tmdb',
      facets: { tag: ['科幻'] },
      yearFrom: 1990,
      yearTo: 1999,
      ratingMin: 8,
      people: ['诺兰'],
      countries: ['US'],
      sort: 'rating',
      order: 'desc',
    })
  })

  it('观看状态用继续播放的条目 id；关键词替换片名搜索', () => {
    const ctx = { section: 'tv' as const, genres: [], watchedIds: [3, 5] }
    expect(applyNlFilter(base, { watched: false }, ctx).excludeIds).toEqual([
      3, 5,
    ])
    expect(applyNlFilter(base, { watched: true }, ctx).ids).toEqual([3, 5])
    expect(
      applyNlFilter(base, { watched: true }, { ...ctx, watchedIds: [] }).ids
    ).toEqual([])
    expect(
      applyNlFilter(base, { watched: false }, { ...ctx, watchedIds: [] })
    ).not.toHaveProperty('excludeIds')
    expect(applyNlFilter(base, { keywords: ['星'] }, ctx).search).toBe('星')
    expect(applyNlFilter(base, {}, ctx)).not.toHaveProperty('search')
  })

  it('番号页已选的分面标签与解析出的类型合并', () => {
    const query = applyNlFilter(
      { ...base, source: 'jav', facets: { tag: ['单体作品'], actor: ['A'] } },
      { genres: ['巨乳'] },
      { section: 'jav', genres: ['巨乳'], watchedIds: [] }
    )
    expect(query.facets).toEqual({ tag: ['单体作品', '巨乳'], actor: ['A'] })
  })

  it('类型名：原样 → 别名（剧集叫法）→ 包含；对不上原样返回', () => {
    expect(resolveGenre('科幻', ['Sci-Fi & Fantasy', '剧情'])).toBe(
      'Sci-Fi & Fantasy'
    )
    expect(resolveGenre('纪录', ['纪录片'])).toBe('纪录片')
    expect(resolveGenre('sci-fi & fantasy', ['Sci-Fi & Fantasy'])).toBe(
      'Sci-Fi & Fantasy'
    )
    expect(resolveGenre('武侠', ['剧情'])).toBe('武侠')
  })

  it('AI 是否已配置：桌面端 + 地址 + 模型 + 需要时有 Key', () => {
    const setup = {
      available: true,
      provider: 'deepseek' as const,
      baseUrl: '',
      model: '',
      keyConfigured: true,
    }
    expect(aiConfigured(setup)).toBe(true)
    expect(aiConfigured({ ...setup, keyConfigured: false })).toBe(false)
    expect(aiConfigured({ ...setup, available: false })).toBe(false)
    expect(
      aiConfigured({ ...setup, provider: 'ollama', keyConfigured: false })
    ).toBe(true)
    expect(aiConfigured({ ...setup, provider: 'custom' })).toBe(false)
    expect(
      aiConfigured({
        ...setup,
        provider: 'custom',
        baseUrl: 'http://x/v1',
        model: 'm',
      })
    ).toBe(true)
  })
})

describe('条件胶囊', () => {
  const filter = {
    type: 'series' as const,
    genres: ['科幻'],
    yearFrom: 1990,
    yearTo: 1999,
    ratingMin: 8,
    people: ['诺兰'],
    countries: ['KR'],
    watched: false,
    sort: { field: 'rating' as const, order: 'desc' as const },
    keywords: ['星'],
  }

  it('按固定顺序生成，类别与分区冲突时标为不生效', () => {
    const chips = nlChips(filter, 'movie')
    expect(chips.map(c => `${c.name}:${c.label}`)).toEqual([
      '类别:剧集',
      '类型:科幻',
      '年代:1990–1999',
      '评分:≥ 8',
      '人物:诺兰',
      '地区:韩国',
      '观看:没看过',
      '片名含:星',
      '排序:评分从高到低',
    ])
    expect(chips[0].inactive).toBe(true)
    expect(nlChips(filter, 'tv')[0].inactive).toBeUndefined()
    expect(nlChips({ yearFrom: 2010 }, 'tv')[0].label).toBe('2010 年以后')
    expect(nlChips({ yearTo: 2000 }, 'tv')[0].label).toBe('2000 年以前')
  })

  it('删除：多值删一个、删光去掉字段；年代整段去掉', () => {
    const chips = nlChips(filter, 'tv')
    const byKey = (key: string): NlChip => chips.find(c => c.key === key)!
    const noGenre = removeChip(filter, byKey('genres:科幻'))
    expect(noGenre).not.toHaveProperty('genres')
    const noYears = removeChip(filter, byKey('years'))
    expect(noYears).not.toHaveProperty('yearFrom')
    expect(noYears).not.toHaveProperty('yearTo')
    expect(removeChip(filter, byKey('sort'))).not.toHaveProperty('sort')
    expect(filter.genres).toEqual(['科幻'])
  })

  it('切换：观看状态与排序方向取反', () => {
    const chips = nlChips(filter, 'tv')
    const watched = chips.find(c => c.field === 'watched')!
    const sort = chips.find(c => c.field === 'sort')!
    expect(toggleChip(filter, watched).watched).toBe(true)
    expect(toggleChip(filter, sort).sort).toEqual({
      field: 'rating',
      order: 'asc',
    })
  })

  it('改值：年份 / 评分 / 地区解析，认不出返回 null，空串等于删除', () => {
    const chips = nlChips(filter, 'tv')
    const byField = (field: string): NlChip =>
      chips.find(c => c.field === field)!
    expect(editChip(filter, byField('years'), '2000-2009')).toMatchObject({
      yearFrom: 2000,
      yearTo: 2009,
    })
    expect(editChip(filter, byField('years'), 'abc')).toBeNull()
    expect(editChip(filter, byField('ratingMin'), '7.5')?.ratingMin).toBe(7.5)
    expect(editChip(filter, byField('ratingMin'), '11')).toBeNull()
    expect(editChip(filter, byField('countries'), '日本')?.countries).toEqual([
      'JP',
    ])
    expect(editChip(filter, byField('countries'), '火星')).toBeNull()
    expect(editChip(filter, byField('people'), '昆汀')?.people).toEqual([
      '昆汀',
    ])
    expect(editChip(filter, byField('people'), ' ')).not.toHaveProperty(
      'people'
    )
    expect(parseYears('2010')).toEqual({ yearFrom: 2010, yearTo: 2010 })
    expect(parseYears('1990-')).toEqual({ yearFrom: 1990 })
    expect(parseYears('-1999')).toEqual({ yearTo: 1999 })
    expect(parseYears('1999-1990')).toEqual({ yearFrom: 1990, yearTo: 1999 })
    expect(countryCode('us')).toBe('US')
    expect(countryCode('香港')).toBe('HK')
  })
})

// —— useNlSearch：AI 用 mock ——
const route = reactive({ query: {} as Record<string, string> })
const ai = vi.hoisted(() => ({
  ready: true,
  chatJson: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/features/ai', async () => {
  const { aiConfigured } = await import('../src/renderer/src/features/ai/ready')
  class AiCallError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  }
  return {
    AiCallError,
    aiAvailable: () => ai.ready,
    aiConfigured,
    aiKeyConfigured: () => true,
    chatJson: ai.chatJson,
  }
})
vi.mock('@/features/player', () => ({
  continueRecords: () =>
    ref([
      { section: 'tv', key: '7' },
      { section: 'movie', key: '9' },
    ]),
}))
vi.mock('@/features/settings', () => ({
  useSetting: (key: string) => ref(key === 'ai.provider' ? 'deepseek' : ''),
}))
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({
    facets: { list: async () => [{ value: '剧情', count: 3 }] },
  }),
}))

describe('useNlSearch（mock AI）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ai.ready = true
    ai.chatJson.mockReset()
    route.query = {}
  })
  afterEach(() => vi.useRealTimers())

  async function mount(
    section: 'tv' | 'jav' = 'tv'
  ): Promise<{ nl: NlSearch; stop: () => void }> {
    const { useNlSearch } =
      await import('../src/renderer/src/features/library/nl-search/use-nl-search')
    const scope = effectScope()
    const nl = scope.run(() =>
      useNlSearch(section, () => ({ types: ['series'], search: 'x' }))
    )!
    return { nl, stop: () => scope.stop() }
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(700)
    await nextTick()
  }

  it('描述句调模型，按问题缓存；查询叠加条件、片名搜索清空', async () => {
    ai.chatJson.mockResolvedValue({
      data: { countries: ['KR'], watched: false, type: 'series' },
    })
    const { nl, stop } = await mount()
    route.query = { q: '没看过的韩剧' }
    await nextTick()
    expect(nl.status.value).toBe('loading')
    await settle()
    expect(nl.status.value).toBe('done')
    expect(nl.search.value).toBe('')
    expect(nl.query()).toEqual({
      types: ['series'],
      countries: ['KR'],
      excludeIds: [7],
    })
    const request = ai.chatJson.mock.calls[0][0]
    expect(request.private).toBe(false)
    expect(request.messages[0].content).toContain('剧情')
    expect(nl.chips.value.map(c => c.label)).toEqual(['剧集', '韩国', '没看过'])

    route.query = { q: '星际穿越' }
    await nextTick()
    expect(nl.search.value).toBe('星际穿越')
    expect(nl.canAsk.value).toBe(true)
    route.query = { q: '没看过的韩剧' }
    await settle()
    expect(ai.chatJson).toHaveBeenCalledTimes(1)
    expect(nl.status.value).toBe('done')
    stop()
  })

  it('番号页带 private；AI 未配置时退回片名搜索并提示去设置', async () => {
    ai.chatJson.mockResolvedValue({ data: { ratingMin: 8 } })
    const jav = await mount('jav')
    route.query = { q: '?评分高的' }
    await settle()
    expect(ai.chatJson.mock.calls[0][0].private).toBe(true)
    jav.stop()

    ai.ready = false
    const tv = await mount()
    route.query = { q: '90 年代的喜剧' }
    await nextTick()
    expect(tv.nl.status.value).toBe('unconfigured')
    expect(tv.nl.search.value).toBe('90 年代的喜剧')
    tv.stop()
  })

  it('模型失败退回片名搜索；点「AI 理解」强制解析普通关键词', async () => {
    ai.chatJson.mockRejectedValueOnce(new Error('boom'))
    const { nl, stop } = await mount()
    route.query = { q: '2010 年以后的动画片' }
    await settle()
    expect(nl.status.value).toBe('error')
    expect(nl.search.value).toBe('2010 年以后的动画片')

    ai.chatJson.mockResolvedValue({ data: { keywords: ['星际'] } })
    route.query = { q: '星际' }
    await nextTick()
    nl.ask()
    await settle()
    expect(nl.status.value).toBe('done')
    expect(nl.query().search).toBe('星际')
    stop()
  })
})
