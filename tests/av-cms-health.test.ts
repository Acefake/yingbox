import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { BrowseCategory } from '../src/renderer/src/features/av/utils/av-catalog'
const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }))
vi.mock('@/features/online', async () => ({
  cmsHealth: (
    await import('../src/renderer/src/features/online/composables/cms-health')
  ).cmsHealth,
  getJson,
  useVODParser: () => ({ search: vi.fn(), getCards: vi.fn() }),
}))
import { cmsHealth } from '../src/renderer/src/features/online/composables/cms-health'
import { useAvSearch } from '../src/renderer/src/features/av/composables/use-av-search'
import { createPageFetchers } from '../src/renderer/src/features/av/composables/av-browse-pages'

const api = 'https://cms.test/api?key=public'
const source = { name: '测试源', api, kind: 'cms' as const }

function pages(): ReturnType<typeof createPageFetchers> {
  return createPageFetchers({
    sourceApi: ref(api),
    categories: ref<BrowseCategory[]>([]),
    categoryId: ref<number | null>(null),
    categoryCache: ref<Record<string, BrowseCategory[]>>({}),
  })
}

function search(): ReturnType<typeof useAvSearch> {
  const result = useAvSearch({
    cmsSources: () => [source],
    cmsCount: () => 1,
    pluginSources: computed(() => []),
  })
  result.keyword.value = '影片'
  return result
}

beforeEach(() => {
  vi.resetAllMocks()
  cmsHealth.clear()
})

describe('AV CMS 按能力的健康状态', () => {
  it('部分源失败时不缓存聚合，下次相同搜索能验证恢复', async () => {
    const other = { name: '另一源', api: 'https://other.test/api' }
    const state = useAvSearch({
      cmsSources: () => [source, other],
      cmsCount: () => 2,
      pluginSources: computed(() => []),
    })
    state.keyword.value = '影片'
    getJson.mockImplementation(async (url: string) => {
      if (url.startsWith(api)) throw new Error('HTTP 503')
      return { code: 1, list: [{ vod_id: 1, vod_name: '影片' }] }
    })
    await state.search()
    expect(getJson).toHaveBeenCalledTimes(2)
    getJson.mockResolvedValue({
      code: 1,
      list: [{ vod_id: 1, vod_name: '影片' }],
    })
    await state.search()
    expect(getJson).toHaveBeenCalledTimes(4)
    expect(cmsHealth.get(api, 'search')?.failures).toBe(0)
  })
  it('连续失败后不再请求，搜索冷却不影响列表，手动重试使搜索缓存失效', async () => {
    getJson.mockRejectedValue(new Error('HTTP 503'))
    const state = search()
    for (let i = 0; i < 4; i++) await state.search()
    expect(getJson).toHaveBeenCalledTimes(3)
    expect(cmsHealth.usable(api, 'search')).toBe(false)
    getJson.mockResolvedValue({ code: 1, list: [] })
    const finish = await pages().fetchCmsPage(source, 1)
    finish()
    expect(cmsHealth.usable(api, 'search')).toBe(false)
    cmsHealth.remove(api)
    await state.search()
    expect(getJson).toHaveBeenCalledTimes(5)
    expect(cmsHealth.get(api, 'search')?.failures).toBe(0)
    const url = new URL(getJson.mock.lastCall![0])
    expect(url.searchParams.get('key')).toBe('public')
    expect(url.searchParams.get('wd')).toBe('影片')
  })

  it('旧搜索和列表请求不覆盖手动重试或新的页面状态', async () => {
    let reject!: (reason: Error) => void
    getJson.mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no
        })
    )
    const pending = search().search()
    cmsHealth.remove(api)
    reject(new Error('HTTP 503'))
    await pending
    expect(cmsHealth.get(api, 'search')).toBeUndefined()
    getJson.mockRejectedValue(new Error('HTTP 404'))
    await expect(pages().fetchCmsPage(source, 1, () => false)).rejects.toThrow(
      'HTTP 404'
    )
    expect(cmsHealth.get(api, 'browse')).toBeUndefined()
  })

  it('列表冷却时不发请求', async () => {
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(api, 'browse', new Error('HTTP 503'))
    await expect(pages().fetchCmsPage(source, 1)).rejects.toThrow('冷却')
    expect(getJson).not.toHaveBeenCalled()
  })
})
