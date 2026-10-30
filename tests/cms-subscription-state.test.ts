import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getJson, selected } = vi.hoisted(() => ({
  getJson: vi.fn(),
  selected: new Set<string>(),
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
  subscriptionUrl,
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
  subscriptionUrl.value = 'https://config.test/list.json'
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
