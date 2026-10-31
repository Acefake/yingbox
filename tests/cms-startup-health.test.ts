/** 启动全量检测自动选择；常规复测保留开关，并支持冷却、强制重试和取消。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const fake = vi.hoisted(() => ({
  getJson: vi.fn(),
  vod: vi.fn(),
  plugins: {
    value: [] as { name: string; api: string; ext: string; type: 3 }[],
  },
  selectedPlugins: { value: [] as string[] },
  avSelected: new Set<string>(),
  selected: new Set<string>(),
  builtins: [
    { name: '可用源', api: 'https://ok.example/api.php/provide/vod' },
    { name: '失效源', api: 'https://bad.example/api.php/provide/vod' },
  ],
  custom: { value: [{ name: '自定义', api: 'https://custom.example/vod' }] },
  subscribed: { value: [{ name: '订阅', api: 'https://sub.example/vod' }] },
  loadPlugins: vi.fn(),
  syncSubscription: vi.fn(),
  adult: false,
  av: { value: [] as { name: string; api: string }[] },
}))

vi.mock('@/components/ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/features/settings', () => ({ getSetting: () => fake.adult }))
vi.mock('@/features/av', () => ({
  useAvSources: () => ({
    allSources: fake.av,
    enabledApis: {
      has: (api: string) => fake.avSelected.has(api),
      add: (api: string) => fake.avSelected.add(api),
      delete: (api: string) => fake.avSelected.delete(api),
    },
    addSources: () => 0,
  }),
}))
vi.mock('../src/renderer/src/features/online/api/online', async original => ({
  ...(await original<Record<string, unknown>>()),
  getJson: fake.getJson,
  onlineApi: () => ({ vod: fake.vod }),
}))
vi.mock(
  '../src/renderer/src/features/online/composables/catspider-sites',
  () => ({
    CATSPIDER_SITES: fake.plugins,
    selectedCatSpider: fake.selectedPlugins,
    isAdultCatSpiderSite: (site: { api: string }) => site.api === 'csp_jable',
  })
)
vi.mock(
  '../src/renderer/src/features/online/composables/use-online-search',
  async () => {
    const { ref } = await import('vue')
    fake.custom = ref(fake.custom.value)
    return {
      DEFAULT_SITES: fake.builtins,
      loadCatSpiderSites: fake.loadPlugins,
      useOnlineSearch: () => ({
        selectedSites: fake.selected,
        customSites: fake.custom,
      }),
    }
  }
)
vi.mock(
  '../src/renderer/src/features/online/composables/cms-subscription',
  () => ({
    subscribedSites: fake.subscribed,
    subscriptionSyncedAt: { value: 0 },
    syncSubscription: fake.syncSubscription,
  })
)

import {
  checkAll,
  checkOnlineSite,
  checkingSet,
  refreshSources,
  startSourceMonitoring,
  statusOf,
  syncAvSources,
} from '../src/renderer/src/features/online/composables/use-source-refresh'
import { cmsHealth } from '../src/renderer/src/features/online/composables/cms-health'

beforeEach(() => {
  vi.resetAllMocks()
  fake.adult = false
  fake.avSelected.clear()
  fake.plugins.value = []
  fake.selectedPlugins.value = []
  fake.vod.mockResolvedValue({ success: true, data: { list: [] } })
  fake.av.value = []
  fake.loadPlugins.mockResolvedValue(undefined)
  fake.syncSubscription.mockResolvedValue(0)
  fake.selected.clear()
  checkingSet.clear()
  cmsHealth.clear()
  fake.getJson.mockImplementation(async (url: string) => {
    if (url.startsWith(fake.builtins[1].api)) throw new Error('超时')
    return { list: [] }
  })
})

describe('内置 CMS 自动启停', () => {
  it('每次启动无视新鲜缓存和关闭状态，检测后可用开启、失败关闭', async () => {
    const ok = fake.builtins[0].api
    const bad = fake.builtins[1].api
    fake.selected.add(bad)
    cmsHealth.success(ok, 'browse')
    cmsHealth.success(bad, 'browse')
    const stop = startSourceMonitoring()
    try {
      await refreshSources(true)
      expect(fake.selected.has(ok)).toBe(true)
      expect(fake.selected.has(bad)).toBe(false)
      expect(fake.selected.has(fake.custom.value[0].api)).toBe(true)
      expect(fake.selected.has(fake.subscribed.value[0].api)).toBe(true)
      expect(
        fake.getJson.mock.calls.filter(([url]) => String(url).startsWith(ok))
      ).toHaveLength(1)
      fake.getJson.mockClear()
      await refreshSources()
      expect(
        fake.getJson.mock.calls.some(([url]) => String(url).startsWith(ok))
      ).toBe(false)
    } finally {
      stop()
    }
    fake.selected.delete(ok)
    fake.getJson.mockClear()
    const next = startSourceMonitoring()
    try {
      await refreshSources(true)
      expect(
        fake.getJson.mock.calls.some(([url]) => String(url).startsWith(ok))
      ).toBe(true)
      expect(fake.selected.has(ok)).toBe(true)
    } finally {
      next()
    }
  })
  it('启动时 CMS 响应无效会关闭来源，后台断线不误关已选来源', async () => {
    const api = fake.builtins[0].api
    fake.selected.add(api)
    fake.getJson.mockResolvedValue({ list: '错误页' })
    await refreshSources(true)
    expect(fake.selected.has(api)).toBe(false)
    fake.selected.add(api)
    const { OnlineTransportError } =
      await import('../src/renderer/src/features/online/api/errors')
    fake.getJson.mockRejectedValue(
      new OnlineTransportError(new Error('后台断开'))
    )
    await refreshSources(true)
    expect(fake.selected.has(api)).toBe(true)
  })
  it('启动检查插件的真实搜索响应，含关闭源；不向普通模式的成人插件发请求', async () => {
    fake.plugins.value = [
      { name: '好插件', api: 'good', ext: 'good.js', type: 3 },
      { name: '坏插件', api: 'bad', ext: 'bad.js', type: 3 },
      { name: '成人插件', api: 'csp_jable', ext: 'adult.js', type: 3 },
    ]
    fake.selectedPlugins.value = ['bad', 'csp_jable']
    fake.vod.mockImplementation(async (request: { siteName: string }) =>
      request.siteName === '坏插件'
        ? { success: false, error: '不可访问' }
        : { success: true, data: { list: [] } }
    )
    await refreshSources(true)
    expect(fake.selectedPlugins.value).toEqual(['csp_jable', 'good'])
    expect(fake.vod.mock.calls.map(([request]) => request.siteName)).toEqual([
      '好插件',
      '坏插件',
    ])
    expect(
      fake.vod.mock.calls.every(([request]) => request.background === true)
    ).toBe(true)
  })
  it('成人模式检测 AV CMS 和插件并自动启停', async () => {
    fake.adult = true
    fake.av.value = [
      { name: 'AV好源', api: 'https://avgood.example/api' },
      { name: 'AV坏源', api: 'https://avbad.example/api' },
    ]
    fake.avSelected.add(fake.av.value[1].api)
    fake.plugins.value = [
      { name: '成人插件', api: 'csp_jable', ext: 'adult.js', type: 3 },
    ]
    fake.getJson.mockImplementation(async (url: string) => {
      if (url.startsWith('https://avbad')) throw new Error('超时')
      return { list: [] }
    })
    await refreshSources(true)
    expect(fake.avSelected.has(fake.av.value[0].api)).toBe(true)
    expect(fake.avSelected.has(fake.av.value[1].api)).toBe(false)
    expect(fake.selectedPlugins.value).toContain('csp_jable')
  })
  it('源在检测中被删除，迟到的成功响应不重新启用', async () => {
    const original = fake.custom.value
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    fake.getJson.mockImplementation(async () => {
      await gate
      return { list: [] }
    })
    const run = checkAll(true, true)
    await vi.waitFor(() => expect(fake.getJson).toHaveBeenCalled())
    fake.custom.value = []
    release()
    try {
      await run
      expect(fake.selected.has(original[0].api)).toBe(false)
    } finally {
      fake.custom.value = original
    }
  })

  it('停止监视器也取消等待中的强制轮次', async () => {
    const api = fake.builtins[0].api
    fake.selected.add(api)
    const stop = startSourceMonitoring()
    await refreshSources()
    fake.getJson.mockClear()
    cmsHealth.remove(api)
    let release!: () => void
    fake.getJson.mockImplementationOnce(() =>
      new Promise<void>(ok => {
        release = ok
      }).then(() => ({ list: [] }))
    )
    const background = checkAll(false)
    try {
      await vi.waitFor(() => expect(fake.getJson).toHaveBeenCalledOnce())
      const manual = checkAll(true)
      stop()
      release()
      await Promise.all([background, manual])
      expect(fake.getJson).toHaveBeenCalledOnce()
    } finally {
      stop()
      release()
      await background
    }
  })
  it('旧远程清单后返回或被取消，不添加来源或改变选择', async () => {
    const original = fake.custom.value
    let resolve!: (value: unknown) => void
    fake.getJson.mockImplementationOnce(
      () =>
        new Promise(ok => {
          resolve = ok
        })
    )
    const old = syncAvSources(false)
    const newer = {
      name: '虎牙资源站',
      api: 'https://new.test/api.php/provide/vod',
    }
    fake.getJson.mockResolvedValueOnce({ data: [newer] })
    try {
      await syncAvSources(false)
      resolve({
        data: [
          { name: '红牛资源站', api: 'https://old.test/api.php/provide/vod' },
        ],
      })
      await old
      expect(fake.custom.value.some(site => site.api === newer.api)).toBe(true)
      expect(
        fake.custom.value.some(site => site.api.includes('old.test'))
      ).toBe(false)
      let active = true
      fake.getJson.mockImplementationOnce(
        () =>
          new Promise(ok => {
            resolve = ok
          })
      )
      const stopped = syncAvSources(false, () => active)
      active = false
      resolve({
        data: [
          {
            name: '红牛资源站',
            api: 'https://stopped.test/api.php/provide/vod',
          },
        ],
      })
      await stopped
      expect(
        fake.custom.value.some(site => site.api.includes('stopped.test'))
      ).toBe(false)
    } finally {
      fake.custom.value = original
    }
  })

  it('手动强制检测等待后台轮次后重新执行，不复用非强制结果', async () => {
    const api = fake.builtins[0].api
    fake.selected.add(api)
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(api, 'search', new Error('HTTP 503'))
    let release!: () => void
    fake.getJson.mockImplementationOnce(() =>
      new Promise<void>(ok => {
        release = () => ok()
      }).then(() => ({ list: [] }))
    )
    const background = checkAll(false)
    await vi.waitFor(() => expect(fake.getJson).toHaveBeenCalledOnce())
    const manual = checkAll(true)
    release()
    await Promise.all([background, manual])
    expect(fake.getJson).toHaveBeenCalledTimes(5)
    expect(cmsHealth.usable(api, 'search')).toBe(true)
  })
  it.each([false, true])(
    '停止后不再启动已排队请求，恢复连接会接续新任务（恢复：%s）',
    async reconnect => {
      const original = fake.custom.value
      fake.custom.value = Array.from({ length: 12 }, (_, i) => ({
        name: `源${i}`,
        api: `https://queue${i}.example/api`,
      }))
      for (const site of [
        ...fake.builtins,
        ...fake.subscribed.value,
        ...fake.custom.value,
      ])
        fake.selected.add(site.api)
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      let count = 0,
        active = 0,
        peak = 0
      fake.getJson.mockImplementation(async (url: string) => {
        if (url.includes('mylazily.github.io')) return { data: [] }
        count++
        peak = Math.max(peak, ++active)
        await gate
        active--
        return { list: [] }
      })
      const online = ref(true)
      const stop = startSourceMonitoring(() => online.value)
      const initial = refreshSources()
      try {
        await vi.waitFor(() => expect(count).toBe(6))
        if (reconnect) {
          online.value = false
          online.value = true
          const resumed = refreshSources()
          release()
          await Promise.all([initial, resumed])
          expect(count).toBe(21)
          expect(cmsHealth.get(fake.builtins[0].api, 'browse')?.failures).toBe(
            0
          )
        } else {
          stop()
          release()
          await initial
          expect(count).toBe(6)
          expect(cmsHealth.get(fake.builtins[0].api, 'browse')).toBeUndefined()
        }
        expect(peak).toBeLessThanOrEqual(6)
      } finally {
        stop()
        release()
        await initial
        fake.custom.value = original
      }
    }
  )
  it('网页服务在线时启动，断线时暂停，恢复连接后继续复测', async () => {
    vi.useFakeTimers()
    const online = ref(false)
    const api = fake.builtins[0].api
    fake.selected.add(api)
    const stop = startSourceMonitoring(() => online.value)
    try {
      expect(fake.loadPlugins).not.toHaveBeenCalled()
      online.value = true
      await refreshSources()
      expect(cmsHealth.get(api, 'browse')?.failures).toBe(0)
      fake.getJson.mockClear()
      online.value = false
      cmsHealth.remove(api)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fake.getJson).not.toHaveBeenCalled()
      online.value = true
      await refreshSources()
      expect(
        fake.getJson.mock.calls.some(([url]) => String(url).startsWith(api))
      ).toBe(true)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
  it('后台复用健康缓存，只复测过期且启用的源；冷却到期再尝试', async () => {
    vi.useFakeTimers()
    try {
      const api = fake.builtins[0].api
      fake.selected.add(api)
      cmsHealth.success(api, 'browse')
      await checkAll(false)
      expect(fake.getJson).not.toHaveBeenCalled()
      for (let i = 0; i < 3; i++)
        cmsHealth.failure(api, 'browse', new Error('HTTP 503'))
      await checkAll(false)
      expect(fake.getJson).not.toHaveBeenCalled()
      vi.setSystemTime(Date.now() + 30 * 60_000)
      await checkAll(false)
      expect(fake.getJson).toHaveBeenCalledOnce()
      expect(cmsHealth.get(api, 'browse')?.failures).toBe(0)
      expect(fake.selected.has(api)).toBe(true)
      expect(fake.selected.has(fake.builtins[1].api)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('停止后台监视器后，不再发起定时探测', async () => {
    vi.useFakeTimers()
    const stop = startSourceMonitoring()
    try {
      await refreshSources()
      fake.getJson.mockClear()
      const api = fake.builtins[0].api
      fake.selected.add(api)
      cmsHealth.success(api, 'browse')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fake.getJson).not.toHaveBeenCalled()
      stop()
      cmsHealth.remove(api)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fake.getJson).not.toHaveBeenCalled()
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
  it.each([false, true])(
    '启动检测限制并发，全部源仍会被检测（含 AV：%s）',
    async includeAv => {
      fake.adult = includeAv
      fake.av.value = Array.from({ length: 8 }, (_, i) => ({
        name: `AV${i}`,
        api: `https://av${i}.example/api`,
      }))
      const original = fake.custom.value
      fake.custom.value = Array.from({ length: 12 }, (_, i) => ({
        name: `源${i}`,
        api: `https://custom${i}.example/vod`,
      }))
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      let active = 0,
        peak = 0
      fake.getJson.mockImplementation(async () => {
        peak = Math.max(peak, ++active)
        await gate
        active--
        return { list: [] }
      })
      const run = checkAll()
      try {
        expect(peak).toBeLessThanOrEqual(6)
        release()
        await run
        expect(fake.getJson).toHaveBeenCalledTimes(includeAv ? 23 : 15)
        expect(peak).toBeLessThanOrEqual(6)
      } finally {
        release()
        await run
        fake.custom.value = original
      }
    }
  )
  it('面板刷新仅检测已启用源，失败不取消勾选；手动关闭的可用源不被重开', async () => {
    fake.selected.add(fake.builtins[1].api)
    fake.loadPlugins.mockRejectedValue(new Error('插件加载失败'))
    fake.syncSubscription.mockRejectedValue(new Error('订阅不可达'))
    await refreshSources()
    expect(fake.selected.has(fake.builtins[0].api)).toBe(false)
    expect(fake.selected.has(fake.builtins[1].api)).toBe(true)
    expect(cmsHealth.get(fake.builtins[0].api, 'browse')).toBeUndefined()
    expect(cmsHealth.get(fake.builtins[1].api, 'browse')?.failures).toBe(1)
    expect(checkingSet.size).toBe(0)
  })

  it('手动检测立即重试并清除冷却，但不修改启用选择', async () => {
    const api = fake.builtins[1].api
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(api, 'search', new Error('超时'))
    expect(cmsHealth.usable(api, 'search')).toBe(false)
    fake.getJson.mockResolvedValue({ list: [] })
    await checkOnlineSite(api)
    expect(cmsHealth.usable(api, 'search')).toBe(true)
    expect(fake.selected.has(api)).toBe(false)
    expect(statusOf(api)).toBe('ok')
  })

  it.each([null, {}, { list: null }, { list: {} }, { list: '错误页' }])(
    '无效 CMS 响应 %j 记录失败，保留启用选择与清单',
    async response => {
      const api = fake.builtins[0].api
      fake.selected.add(api)
      fake.getJson.mockResolvedValue(response)
      await checkOnlineSite(api)
      expect(fake.selected.has(api)).toBe(true)
      expect(cmsHealth.get(api, 'browse')?.failures).toBe(1)
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
