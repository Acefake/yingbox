// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { existsSync, readFileSync } from 'node:fs'
import { h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { blockBusyClick, listWaiting } from '@/components/ui/feedback'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'

// 搜索记录读写 localStorage（Node 里没有）
const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
})

// 在线页组件的外部依赖：只替换网络与路由，组件本身真渲染
vi.mock('@/features/online/api/online', () => ({
  getJson: vi.fn(() => new Promise(() => {})),
  doubanBrowse: vi.fn(() => new Promise(() => {})),
  tmdb: vi.fn(() => Promise.resolve(null)),
  onlineApi: vi.fn(),
}))
const search = {
  keyword: ref(''),
  results: ref<Array<Record<string, string>>>([]),
  loading: ref(false),
  error: ref(''),
  skippedPlugins: ref<string[]>([]),
  search: vi.fn(() => Promise.resolve()),
}
vi.mock('@/features/online/composables/use-online-search', () => ({
  useOnlineSearch: () => search,
}))
const route = { query: {} as Record<string, string>, path: '/' }
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: vi.fn(() => Promise.resolve()) }),
}))

describe('等待反馈的分工', () => {
  it('没有内容时等待 → 骨架；已有内容时还在进行 → 保留内容，只给轻提示', () => {
    expect(listWaiting(true, 0)).toBe('skeleton')
    expect(listWaiting(true, 3)).toBe('more')
    expect(listWaiting(false, 0)).toBeNull()
    expect(listWaiting(false, 3)).toBeNull()
  })

  it('忙时拦下点击：阻止默认行为（含表单提交）并截断后续监听', () => {
    const event = new Event('click', { cancelable: true })
    const stop = vi.spyOn(event, 'stopImmediatePropagation')
    blockBusyClick(true, event)
    expect(event.defaultPrevented).toBe(true)
    expect(stop).toHaveBeenCalled()

    const idle = new Event('click', { cancelable: true })
    const idleStop = vi.spyOn(idle, 'stopImmediatePropagation')
    blockBusyClick(false, idle)
    expect(idle.defaultPrevented).toBe(false)
    expect(idleStop).not.toHaveBeenCalled()
  })
})

describe('UiSkeleton / UiLoadingDots', () => {
  it('骨架：整块 aria-busy，屏幕阅读器读「正在加载」，占位格对辅助技术隐藏', async () => {
    const html = await renderToString(h(UiSkeleton, { count: 5 }))
    expect(html).toMatch(/class="ui-poster-grid ui-skeleton"/)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('正在加载')
    expect(
      html.match(/class="ui-skeleton__card" aria-hidden="true"/g)
    ).toHaveLength(5)
    expect(html).not.toContain('is-landscape')
    const wide = await renderToString(
      h(UiSkeleton, { landscape: true, label: '正在搜索' })
    )
    expect(wide).toContain('is-landscape')
    expect(wide).toContain('正在搜索')
    expect(wide.match(/ui-skeleton__card/g)).toHaveLength(12)
  })

  it('三点：role=status，可见文字；点本身对辅助技术隐藏', async () => {
    const html = await renderToString(h(UiLoadingDots, { label: '仍在搜索' }))
    expect(html).toContain('role="status"')
    expect(html).toContain('仍在搜索')
    expect(html.match(/class="ui-loading-dots__dot"/g)).toHaveLength(3)
    expect(html).toMatch(/class="ui-loading-dots__dots" aria-hidden="true"/)
    const bare = await renderToString(h(UiLoadingDots))
    expect(bare).toMatch(/class="ui-sr-only">正在加载</)
  })
})

describe('按钮忙态：可聚焦、不能重复触发', () => {
  it('UiButton loading：aria-busy + aria-disabled，不加 disabled（焦点不丢）', async () => {
    const busy = await renderToString(
      h(UiButton, { label: '保存', loading: true })
    )
    expect(busy).toContain('aria-busy="true"')
    expect(busy).toContain('aria-disabled="true"')
    expect(busy).not.toMatch(/\sdisabled(\s|>|=)/)
    const idle = await renderToString(h(UiButton, { label: '保存' }))
    expect(idle).not.toContain('aria-busy')
    expect(idle).not.toContain('aria-disabled')
    const off = await renderToString(
      h(UiButton, { label: '保存', disabled: true })
    )
    expect(off).toMatch(/\sdisabled(\s|>|=)/)
  })

  it('UiIconButton loading 同样可聚焦', async () => {
    const busy = await renderToString(
      h(UiIconButton, { icon: 'refresh', label: '刷新', loading: true })
    )
    expect(busy).toContain('aria-busy="true"')
    expect(busy).toContain('aria-disabled="true"')
    expect(busy).not.toMatch(/\sdisabled(\s|>|=)/)
    const off = await renderToString(
      h(UiIconButton, { icon: 'refresh', label: '刷新', disabled: true })
    )
    expect(off).toMatch(/\sdisabled(\s|>|=)/)
  })

  it('两个按钮都用 blockBusyClick 拦点击', () => {
    for (const file of ['UiButton.vue', 'UiIconButton.vue']) {
      const text = readFileSync(
        `src/renderer/src/components/ui/${file}`,
        'utf8'
      )
      expect(text, file).toMatch(/@click="blockBusyClick\(loading, \$event\)"/)
    }
  })
})

describe('首屏等待内容结构用骨架', () => {
  beforeEach(() => {
    search.results.value = []
    search.loading.value = false
    route.query = {}
  })

  it('豆瓣热门：首屏是海报骨架，不再是「加载中...」文字', async () => {
    const { default: DoubanBrowse } =
      await import('@/features/online/components/DoubanBrowse.vue')
    const html = await renderToString(
      h(DoubanBrowse, { target: { type: 'hot', kind: 'movie' } })
    )
    expect(html).toContain('ui-skeleton')
    expect(html).not.toContain('加载中')
  })

  it('在线搜索：还没有结果时是骨架；已有结果还在搜其他源时保留结果、底部三点', async () => {
    const { default: SearchTab } =
      await import('@/features/online/components/SearchTab.vue')
    route.query = { q: '繁花' }
    search.loading.value = true
    const first = await renderToString(h(SearchTab))
    expect(first).toContain('ui-skeleton')
    expect(first).not.toContain('ui-loading-dots')

    search.results.value = [
      { vod_name: '繁花', source_name: '甲', _source: 'cms', vod_pic: '' },
    ]
    const more = await renderToString(h(SearchTab))
    expect(more).not.toContain('ui-skeleton')
    expect(more).toContain('ui-loading-dots')
    expect(more.indexOf('ui-loading-dots')).toBeGreaterThan(
      more.indexOf('CMS源')
    )

    search.loading.value = false
    const done = await renderToString(h(SearchTab))
    expect(done).not.toContain('ui-loading-dots')
  })

  it('接线：在线浏览、AV 搜索、媒体库海报墙首屏都用 UiSkeleton，旧的手写骨架删掉', () => {
    const read = (file: string): string =>
      readFileSync(`src/renderer/src/${file}`, 'utf8')
    for (const file of [
      'features/online/components/VodBrowse.vue',
      'features/av/components/AvSearchResults.vue',
      'features/library/LibraryPage.vue',
    ]) {
      expect(read(file), file).toMatch(/<UiSkeleton\b/)
    }
    expect(read('features/library/LibraryPage.vue')).toMatch(
      /<UiSkeleton\s+v-if="!ready"/
    )
    expect(
      existsSync('src/renderer/src/features/av/components/AvSkeletonGrid.vue')
    ).toBe(false)
    expect(read('assets/styles/components.css')).not.toContain('skel')
    expect(read('features/online/components/VodBrowse.vue')).not.toContain(
      'skel'
    )
    expect(read('features/online/components/VodBrowse.vue')).toMatch(
      /<UiLoadingDots\b/
    )
  })
})
