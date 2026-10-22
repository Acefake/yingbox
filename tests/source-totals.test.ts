/**
 * 数据源面板工具栏的统计与批量操作（use-source-totals）：
 * 失效源计数（AV 源只在成人模式下计入）、一键更新的顺序、停用失效源只动失效的。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }
})

const calls: string[] = []
vi.mock(
  '../src/renderer/src/features/online/composables/use-source-refresh',
  async importOriginal => {
    const real = await importOriginal<Record<string, unknown>>()
    return {
      ...real,
      syncAvSources: vi.fn(
        async (show: boolean) => void calls.push(`sync:${show}`)
      ),
      checkAll: vi.fn(async () => void calls.push('checkAll')),
    }
  }
)
vi.mock(
  '../src/renderer/src/features/online/composables/plugin-health',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    retryAllPlugins: vi.fn(async () => void calls.push('retryAll')),
  })
)
vi.mock('@/components/ui', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmDialog: vi.fn(async (opts: { title: string; onOk?: () => void }) => {
    calls.push(`confirm:${opts.title}`)
    opts.onOk?.()
    return true
  }),
}))

const { useSourceTotals } =
  await import('../src/renderer/src/features/online/composables/use-source-totals')
const { avStatusMap, checkingAll, statusMap, syncingAv } =
  await import('../src/renderer/src/features/online/composables/use-source-refresh')
const { useOnlineSearch } =
  await import('../src/renderer/src/features/online/composables/use-online-search')
const { useAvSources } = await import('../src/renderer/src/features/av')
const { setSetting } = await import('../src/renderer/src/features/settings')

const { customSites, selectedSites, DEFAULT_SITES } = useOnlineSearch()
const av = useAvSources()

afterEach(async () => {
  calls.length = 0
  for (const k of Object.keys(statusMap)) delete statusMap[k]
  for (const k of Object.keys(avStatusMap)) delete avStatusMap[k]
  customSites.value = []
  checkingAll.value = false
  syncingAv.value = false
  await setSetting('app.adultMode', false)
})

describe('use-source-totals', () => {
  it('失效源计数：在线源总是计入，AV 源只在成人模式下计入', async () => {
    const t = useSourceTotals()
    const avApi = av.allSources.value[0]?.api
    expect(avApi).toBeTruthy()
    statusMap[DEFAULT_SITES[0].api] = 'fail'
    avStatusMap[avApi!] = 'fail'
    expect(t.totalFail.value).toBe(1)
    expect(t.totalSources.value).toBe(DEFAULT_SITES.length)
    await setSetting('app.adultMode', true)
    expect(t.totalFail.value).toBe(2)
    expect(t.totalSources.value).toBe(
      DEFAULT_SITES.length + av.allSources.value.length
    )
  })

  it('一键更新：先同步（提示结果）、再解除插件熔断、再全部检测；更新中重复点击不做事', async () => {
    const t = useSourceTotals()
    await t.updateSources()
    expect(calls).toEqual(['sync:true', 'retryAll', 'checkAll'])
    calls.length = 0
    checkingAll.value = true
    expect(t.updatingSources.value).toBe(true)
    await t.updateSources()
    expect(calls).toEqual([])
  })

  it('停用失效源：确认后只停用失效的在线源与 AV 源', async () => {
    const t = useSourceTotals()
    await setSetting('app.adultMode', true)
    const [good, bad] = [DEFAULT_SITES[0].api, DEFAULT_SITES[1].api]
    selectedSites.add(good)
    selectedSites.add(bad)
    statusMap[bad] = 'fail'
    const avApi = av.allSources.value[0].api
    av.enabledApis.add(avApi)
    avStatusMap[avApi] = 'fail'
    t.disableAllFailed()
    expect(calls).toEqual(['confirm:禁用 2 个失效数据源？'])
    expect(selectedSites.has(good)).toBe(true)
    expect(selectedSites.has(bad)).toBe(false)
    expect(av.enabledApis.has(avApi)).toBe(false)
  })
})
