import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const { getJson, vodSearch, sites, plugins } = vi.hoisted(() => ({
  getJson: vi.fn(),
  vodSearch: vi.fn(),
  sites: [{ name: 'CMS', api: 'https://cms.example/api?key=demo' }],
  plugins: [{ name: '插件', api: 'plugin:test' }],
}))
vi.mock('../src/renderer/src/features/settings', () => ({
  getSetting: () => false,
}))
vi.mock('../src/renderer/src/features/online/api/online', () => ({ getJson }))
vi.mock('../src/renderer/src/features/online/composables/cms-sites', () => ({
  DEFAULT_SITES: sites,
  customSites: ref([]),
  selectedSites: { has: () => true },
}))
vi.mock(
  '../src/renderer/src/features/online/composables/cms-subscription',
  () => ({
    subscribedSites: ref([]),
  })
)
vi.mock(
  '../src/renderer/src/features/online/composables/catspider-sites',
  () => ({
    CATSPIDER_SITES: ref(plugins),
    selectedCatSpider: ref(['plugin:test']),
    loadCatSpiderSites: vi.fn(),
    isAdultCatSpiderSite: () => false,
  })
)
vi.mock(
  '../src/renderer/src/features/online/composables/plugin-health',
  () => ({
    pluginSearchHealthOf: () => undefined,
  })
)
vi.mock('../src/renderer/src/features/online/utils/plugin-health', () => ({
  splitByHealth: (usable: unknown[]) => ({ usable, skipped: [] }),
}))
vi.mock(
  '../src/renderer/src/features/online/composables/use-vod-parser',
  () => ({
    useVODParser: () => ({ search: vodSearch }),
  })
)
import { useOnlineSearch } from '../src/renderer/src/features/online/composables/use-online-search'
import { cmsHealth } from '../src/renderer/src/features/online/composables/cms-health'

beforeEach(() => {
  vi.resetAllMocks()
  cmsHealth.clear()
  getJson.mockResolvedValue({ list: [] })
  vodSearch.mockResolvedValue({ success: true, data: { list: [] } })
})

describe('在线搜索的失败反馈与 CMS 详情', () => {
  it('连续失败后跳过 CMS 搜索，详情仍可取，解除冷却后恢复查询', async () => {
    const state = useOnlineSearch()
    getJson.mockRejectedValue(new Error('timeout'))
    for (let i = 0; i < 3; i++) await state.search('影片')
    expect(getJson).toHaveBeenCalledTimes(3)
    await state.search('影片')
    expect(getJson).toHaveBeenCalledTimes(3)
    expect(state.skippedCms.value).toEqual(['CMS'])
    getJson.mockResolvedValue({
      list: [{ vod_play_url: '正片$https://video.example/a.mp4' }],
    })
    expect(
      await state.fetchDetail({
        vod_id: '1',
        vod_name: '影片',
        type_name: '电影',
        vod_year: '',
        vod_remarks: '',
        vod_pic: '',
        api_url: sites[0].api,
      })
    ).toHaveLength(1)
    expect(cmsHealth.usable(sites[0].api, 'search')).toBe(false)
    cmsHealth.remove(sites[0].api)
    getJson.mockResolvedValue({ list: [] })
    await state.search('影片')
    expect(state.skippedCms.value).toEqual([])
    expect(cmsHealth.get(sites[0].api, 'search')?.failures).toBe(0)
  })
  it('详情请求保留源地址参数，并正确编码影片 id', async () => {
    getJson.mockResolvedValue({
      list: [{ vod_play_url: '正片$https://video.example/a.mp4' }],
    })
    const state = useOnlineSearch()
    const groups = await state.fetchDetail({
      vod_id: 'a&b',
      vod_name: '影片',
      type_name: '电影',
      vod_year: '2026',
      vod_remarks: '',
      vod_pic: '',
      api_url: sites[0].api,
      source_name: 'CMS',
    })
    const url = new URL(getJson.mock.calls[0][0])
    expect(url.searchParams.get('key')).toBe('demo')
    expect(url.searchParams.get('ac')).toBe('videolist')
    expect(url.searchParams.get('ids')).toBe('a&b')
    expect(groups).toHaveLength(1)
  })

  it('全部源失败时显示错误，而非正常空结果', async () => {
    getJson.mockRejectedValue(new Error('timeout'))
    vodSearch.mockResolvedValue({ success: false, error: 'timeout' })
    const state = useOnlineSearch()
    await state.search('影片')
    expect(state.error.value).toContain('失败')
    expect(state.failedSources.value).toEqual(['CMS', '插件'])
    expect(state.loading.value).toBe(false)
  })

  it('插件标记不可用且返回成功空列表时，仍提示源不可用', async () => {
    getJson.mockRejectedValue(new Error('timeout'))
    vodSearch.mockResolvedValue({
      success: true,
      data: { list: [] },
      unavailable: '源暂不可用',
    })
    const state = useOnlineSearch()
    await state.search('影片')
    expect(state.error.value).toContain('暂不可用')
    expect(state.skippedPlugins.value).toEqual(['插件'])
  })

  it('部分失败保留可用结果，下一轮正常空结果不残留错误', async () => {
    getJson.mockRejectedValueOnce(new Error('timeout'))
    vodSearch.mockResolvedValueOnce({
      success: true,
      data: { list: [{ vod_id: '1', vod_name: '影片' }] },
    })
    const state = useOnlineSearch()
    await state.search('影片')
    expect(state.results.value).toHaveLength(1)
    expect(state.error.value).toBe('')
    expect(state.failedSources.value).toEqual(['CMS'])
    await state.search('不存在的影片')
    expect(state.results.value).toEqual([])
    expect(state.error.value).toBe('')
    expect(state.failedSources.value).toEqual([])
  })

  it('清空查询会取消旧请求，并清除失败提示及迟到的结果', async () => {
    const state = useOnlineSearch()
    getJson.mockRejectedValueOnce(new Error('timeout'))
    await state.search('失败的影片')
    expect(state.failedSources.value).toEqual(['CMS'])
    let finish!: (value: unknown) => void
    getJson.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = state.search('等待中的影片')
    await Promise.resolve()
    await state.search('')
    finish({ list: [{ vod_id: '1', vod_name: '迟到的影片' }] })
    await pending
    expect(state.keyword.value).toBe('')
    expect(state.results.value).toEqual([])
    expect(state.failedSources.value).toEqual([])
    expect(state.skippedPlugins.value).toEqual([])
    expect(state.error.value).toBe('')
    expect(state.loading.value).toBe(false)
  })
})
