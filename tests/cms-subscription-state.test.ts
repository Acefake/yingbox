import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getJson, selected, addAvSources } = vi.hoisted(() => ({
  getJson: vi.fn(),
  selected: new Set<string>(),
  addAvSources: vi.fn(),
}))
vi.mock('@/features/av', () => ({
  useAvSources: () => ({ addSources: addAvSources }),
}))
vi.mock('../src/renderer/src/features/online/api/online', () => ({ getJson }))
vi.mock('../src/renderer/src/features/online/composables/cms-sites', () => ({
  DEFAULT_SITES: [],
  customSites: { value: [] },
  selectedSites: selected,
}))
import {
  subscribedSites,
  subscriptionSyncedAt,
  syncSubscription,
} from '../src/renderer/src/features/online/composables/cms-subscription'
const site = (name: string): { name: string; api: string } => ({
  name,
  api: `https://${name}.test/api.php/provide/vod`,
})
beforeEach(() => {
  vi.resetAllMocks()
  selected.clear()
  subscribedSites.value = []
  subscriptionSyncedAt.value = 0
})

describe('订阅同步的代次与选择保留', () => {
  it('旧清单后返回不覆盖新清单和开关', async () => {
    let resolve!: (value: unknown) => void
    getJson.mockImplementationOnce(
      () =>
        new Promise(ok => {
          resolve = ok
        })
    )
    const old = syncSubscription()
    getJson.mockResolvedValueOnce({ sites: [site('new')] })
    await syncSubscription()
    resolve({ sites: [site('old')] })
    await old
    expect(subscribedSites.value).toEqual([site('new')])
    expect(selected.has(site('new').api)).toBe(true)
    expect(selected.has(site('old').api)).toBe(false)
  })
  it('取消后清单回包不修改状态；既有关闭源不重开，新源默认开启', async () => {
    let resolve!: (value: unknown) => void
    let active = true
    getJson.mockImplementationOnce(
      () =>
        new Promise(ok => {
          resolve = ok
        })
    )
    const stopped = syncSubscription(() => active)
    active = false
    resolve({ sites: [site('stopped')] })
    await stopped
    expect(subscribedSites.value).toEqual([])
    expect(subscriptionSyncedAt.value).toBe(0)
    subscribedSites.value = [site('existing')]
    getJson.mockResolvedValueOnce({ sites: [site('existing'), site('new')] })
    await syncSubscription()
    expect(selected.has(site('existing').api)).toBe(false)
    expect(selected.has(site('new').api)).toBe(true)
  })
})

describe('成人站并入 AV 板块', () => {
  it('订阅里的成人站交给 AV，普通源只收普通站', async () => {
    const adult = {
      name: '🔞成人',
      api: 'https://adult.test/api.php/provide/vod',
    }
    getJson.mockResolvedValueOnce({
      api_site: { a: site('plain'), b: adult },
    })
    await syncSubscription()
    expect(subscribedSites.value).toEqual([site('plain')])
    expect(addAvSources).toHaveBeenCalledWith([
      { name: '成人', api: adult.api },
    ])
  })
  it('两个订阅只要一个成功就同步', async () => {
    getJson.mockResolvedValueOnce({ sites: [site('one')] })
    getJson.mockRejectedValue(new Error('down'))
    await syncSubscription()
    expect(subscribedSites.value).toEqual([site('one')])
  })
})

describe('单个订阅失败', () => {
  it('不丢上次缓存里的站，也不停用它们', async () => {
    subscribedSites.value = [site('kept')]
    selected.add(site('kept').api)
    getJson.mockResolvedValueOnce({ sites: [site('new')] })
    getJson.mockRejectedValue(new Error('down'))
    await syncSubscription()
    expect(subscribedSites.value.map(s => s.name).sort()).toEqual([
      'kept',
      'new',
    ])
    expect(selected.has(site('kept').api)).toBe(true)
  })
})
