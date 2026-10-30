/** CMS 健康缓存与测活：保留用户开关，按能力冷却，支持强制重试和取消。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

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
    addSources: () => 0,
  }),
}))
vi.mock('../src/renderer/src/features/online/api/online', async original => ({
  ...(await original<Record<string, unknown>>()),
  getJson: fake.getJson,
}))
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
  it('启动仅检测已启用源，失败不取消勾选；手动关闭的可用源不被重开', async () => {
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
