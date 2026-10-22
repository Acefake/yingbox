// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * 不抢阅读位置：刷新 / 追加内容时，旧内容一直留到新内容到达再整批替换，
 * 列表区高度不会先塌成 0（那会让滚动容器把用户的位置夹回顶部）。
 */

type CardsResult = { success: boolean; data?: unknown }
let pendingCards: Array<(result: CardsResult) => void> = []
const getCards = vi.fn(
  () => new Promise<CardsResult>(resolve => pendingCards.push(resolve))
)
const getConfig = vi.fn(() =>
  Promise.resolve({
    success: true,
    data: { config: { tabs: [{ name: '电影', ext: { id: '1' } }] } },
  })
)
vi.mock('@/features/online/composables/use-vod-parser', () => ({
  useVODParser: () => ({ getConfig, getCards }),
}))

const page = (names: string[]): CardsResult => ({
  success: true,
  data: { list: names.map((name, i) => ({ vod_id: `${i}`, vod_name: name })) },
})
const settle = async (result: CardsResult): Promise<void> => {
  const resolve = pendingCards.shift()
  resolve?.(result)
  await vi.waitFor(() => expect(getCards).toHaveBeenCalled())
  await new Promise(r => setTimeout(r, 0))
}

describe('在线「媒体库」刷新', () => {
  it('点刷新时旧卡片留到新一页到达才替换，加载失败才清空', async () => {
    const { useVodBrowse } =
      await import('@/features/online/composables/use-vod-browse')
    pendingCards = []
    const browse = useVodBrowse()
    const loadingSources = browse.loadSources([
      { key: 'a', name: '甲', api: 'https://a.example/a.js', type: 3 },
    ] as never)
    await vi.waitFor(() => expect(pendingCards).toHaveLength(1))
    await settle(page(['一', '二', '三']))
    await loadingSources
    expect(browse.cards.value.map(c => c.vod_name)).toEqual(['一', '二', '三'])

    const reloading = browse.reload()
    expect(browse.loading.value).toBe(true)
    expect(browse.cards.value.map(c => c.vod_name)).toEqual(['一', '二', '三'])
    await settle(page(['四', '五']))
    await reloading
    expect(browse.cards.value.map(c => c.vod_name)).toEqual(['四', '五'])

    const failing = browse.reload()
    expect(browse.cards.value).toHaveLength(2)
    await settle({ success: false })
    await failing
    expect(browse.cards.value).toEqual([])
  })
})

describe('豆瓣换条件 / 加载下一页', () => {
  it('海报网格只在没有内容时让位给骨架，刷新期间保留旧海报', () => {
    const text = readFileSync(
      'src/renderer/src/features/online/components/DoubanSection.vue',
      'utf8'
    )
    expect(text).toMatch(/<UiSkeleton\s+v-if="waiting === 'skeleton'"/)
    expect(text).toMatch(
      /const waiting = computed\(\(\) =>\s*listWaiting\(pending\.value, items\.value\.length\)/
    )
    expect(text).not.toMatch(/v-if="pending"/)
  })
})
