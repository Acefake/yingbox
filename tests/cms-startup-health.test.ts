/** 内置 CMS 启动测活：检测结果持久化到启用集合，恢复可重新开启，其他类型保留选择。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  getJson: vi.fn(),
  selected: new Set<string>(),
  builtins: [
    { name: '可用源', api: 'https://ok.example/api.php/provide/vod' },
    { name: '失效源', api: 'https://bad.example/api.php/provide/vod' },
  ],
  custom: { value: [{ name: '自定义', api: 'https://custom.example/vod' }] },
  subscribed: { value: [{ name: '订阅', api: 'https://sub.example/vod' }] },
  loadPlugins: vi.fn(),
  syncSubscription: vi.fn(),
}))

vi.mock('@/components/ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/features/settings', () => ({ getSetting: () => false }))
vi.mock('@/features/av', () => ({
  useAvSources: () => ({
    allSources: { value: [] },
    addSources: () => 0,
  }),
}))
vi.mock('../src/renderer/src/features/online/api/online', async original => ({
  ...(await original<Record<string, unknown>>()),
  getJson: fake.getJson,
}))
vi.mock(
  '../src/renderer/src/features/online/composables/use-online-search',
  () => ({
    DEFAULT_SITES: fake.builtins,
    loadCatSpiderSites: fake.loadPlugins,
    useOnlineSearch: () => ({
      selectedSites: fake.selected,
      customSites: fake.custom,
    }),
  })
)
vi.mock(
  '../src/renderer/src/features/online/composables/cms-subscription',
  () => ({
    subscribedSites: fake.subscribed,
    syncSubscription: fake.syncSubscription,
  })
)

import {
  checkOnlineSite,
  checkingSet,
  refreshSources,
  statusMap,
} from '../src/renderer/src/features/online/composables/use-source-refresh'

beforeEach(() => {
  vi.resetAllMocks()
  fake.loadPlugins.mockResolvedValue(undefined)
  fake.syncSubscription.mockResolvedValue(0)
  fake.selected.clear()
  checkingSet.clear()
  for (const api of Object.keys(statusMap)) delete statusMap[api]
  fake.getJson.mockImplementation(async (url: string) => {
    if (url.startsWith(fake.builtins[1].api)) throw new Error('超时')
    return { list: [] }
  })
})

describe('内置 CMS 自动启停', () => {
  it('启动刷新开启可用源、关闭超时源；插件和订阅同步失败也会继续检测', async () => {
    fake.selected.add(fake.builtins[1].api)
    fake.loadPlugins.mockRejectedValue(new Error('插件加载失败'))
    fake.syncSubscription.mockRejectedValue(new Error('订阅不可达'))
    await refreshSources()
    expect(fake.selected.has(fake.builtins[0].api)).toBe(true)
    expect(fake.selected.has(fake.builtins[1].api)).toBe(false)
    expect(statusMap[fake.builtins[0].api]).toBe('ok')
    expect(statusMap[fake.builtins[1].api]).toBe('fail')
    expect(checkingSet.size).toBe(0)
  })

  it('后续刷新会重新检测失效源，恢复后自动启用', async () => {
    await refreshSources()
    fake.getJson.mockResolvedValue({ list: [] })
    await refreshSources()
    expect(fake.selected.has(fake.builtins[1].api)).toBe(true)
    expect(statusMap[fake.builtins[1].api]).toBe('ok')
  })

  it.each([null, {}, { list: null }, { list: {} }, { list: '错误页' }])(
    '无效 CMS 响应 %j 不算可用，停用后保留内置清单',
    async response => {
      const api = fake.builtins[0].api
      fake.selected.add(api)
      fake.getJson.mockResolvedValue(response)
      await checkOnlineSite(api)
      expect(fake.selected.has(api)).toBe(false)
      expect(statusMap[api]).toBe('fail')
      expect(fake.builtins.some(site => site.api === api)).toBe(true)
    }
  )

  it('自定义与订阅源检测不改写用户启用选择；查询保留 API 原参数', async () => {
    const custom = `${fake.custom.value[0].api}?token=public&ac=old`
    fake.selected.add(custom)
    fake.getJson.mockRejectedValueOnce(new Error('离线'))
    await checkOnlineSite(custom)
    expect(fake.selected.has(custom)).toBe(true)
    await checkOnlineSite(fake.subscribed.value[0].api)
    expect(fake.selected.has(fake.subscribed.value[0].api)).toBe(false)
    const url = new URL(fake.getJson.mock.calls[0][0])
    expect(url.searchParams.get('token')).toBe('public')
    expect(url.searchParams.getAll('ac')).toEqual(['videolist'])
  })

  it('并发启动刷新复用同一个任务', async () => {
    const first = refreshSources()
    const second = refreshSources()
    expect(second).toBe(first)
    await first
    expect(fake.loadPlugins).toHaveBeenCalledTimes(1)
    expect(fake.syncSubscription).toHaveBeenCalledTimes(1)
  })
})
