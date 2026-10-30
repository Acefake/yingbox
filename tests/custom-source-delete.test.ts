/**
 * 删除自定义源：列表按连接状态排序显示，删除必须删掉用户点的那一行（按 api 认源），
 * 不能拿排序后的位置去删未排序的存储数组。
 * 行组件换成记录 props 与 delete 回调的替身，SSR 渲染后直接调用某一行的删除回调。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

vi.hoisted(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }
})

/** 渲染出的每一行：名字、api、是否可删除、删除回调。 */
type Row = {
  name: string
  api: string
  deletable: boolean
  onDelete?: () => void
}
const rows: Row[] = []
const confirmTitles: string[] = []

vi.mock(
  '../src/renderer/src/features/online/components/SourceSiteRow.vue',
  () => ({
    default: defineComponent({
      props: { name: String, api: String, deletable: Boolean },
      setup(props, { attrs }) {
        rows.push({
          name: props.name ?? '',
          api: props.api ?? '',
          deletable: props.deletable,
          onDelete: attrs.onDelete as (() => void) | undefined,
        })
        return () => h('div')
      },
    }),
  })
)
vi.mock('@/components/ui', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmDialog: vi.fn(async (opts: { title: string; onOk?: () => void }) => {
    confirmTitles.push(opts.title)
    opts.onOk?.()
    return true
  }),
}))

const { renderToString } = await import('vue/server-renderer')
const { default: OnlineSourcesTab } =
  await import('../src/renderer/src/features/online/components/OnlineSourcesTab.vue')
const { useOnlineSearch } =
  await import('../src/renderer/src/features/online/composables/use-online-search')
const { cmsHealth } =
  await import('../src/renderer/src/features/online/composables/cms-health')

const { customSites, selectedSites } = useOnlineSearch()

const A = { name: '源A', api: 'https://a.test/api.php' }
const B = { name: '源B', api: 'https://b.test/api.php' }
const C = { name: '源C', api: 'https://c.test/api.php' }

const renderRows = async (): Promise<Row[]> => {
  rows.length = 0
  await renderToString(h(OnlineSourcesTab, { plugins: [] }))
  return rows.filter(r => r.deletable)
}

afterEach(() => {
  customSites.value = []
  cmsHealth.clear()
  confirmTitles.length = 0
})

describe('删除自定义源', () => {
  it('排序后与存储顺序不同：删掉的是点的那一行', async () => {
    customSites.value = [A, B, C]
    // A 失效、C 通过：显示顺序 C、B、A，与存储顺序 A、B、C 不同
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(A.api, 'browse', new Error('HTTP 503'))
    cmsHealth.success(C.api, 'browse')
    selectedSites.add(C.api)
    const shown = await renderRows()
    expect(shown.map(r => r.name)).toEqual(['源C', '源B', '源A'])

    // 点第一行（源C）的删除
    shown[0].onDelete?.()
    expect(confirmTitles).toEqual(['删除数据源“源C”？'])
    expect(customSites.value.map(s => s.name)).toEqual(['源A', '源B'])
    expect(selectedSites.has(C.api)).toBe(false)
    expect(cmsHealth.get(C.api, 'browse')).toBeUndefined()
    // 没点的源状态不受影响
    expect(cmsHealth.status(A.api)).toBe('fail')
  })

  it('删除后重新渲染，剩下的行各自删自己', async () => {
    customSites.value = [A, B, C]
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(A.api, 'browse', new Error('HTTP 503'))
    cmsHealth.success(C.api, 'browse')
    let shown = await renderRows()
    shown.find(r => r.name === '源A')?.onDelete?.()
    expect(customSites.value.map(s => s.name)).toEqual(['源B', '源C'])

    shown = await renderRows()
    expect(shown.map(r => r.name)).toEqual(['源C', '源B'])
    shown[1].onDelete?.()
    expect(customSites.value.map(s => s.name)).toEqual(['源C'])
  })
})
