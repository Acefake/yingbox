/**
 * 详情页底部分区胶囊：首屏（Hero 在身后）时淡出、对读屏与键盘隐藏，滚过 Hero 后出现。
 * 显示与否由 useHeroBackdrop 的 tabsShown 决定，判定规则见 detailTabsShownAt 的用例。
 */
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import DetailTabs from '../../../src/renderer/src/features/library/detail/DetailTabs.vue'
import type { DetailTab } from '../../../src/renderer/src/features/library/detail/detail-view'

const tabs: DetailTab[] = [
  { key: 'overview', label: '概览' },
  { key: 'episodes', label: '剧集' },
  { key: 'about', label: '关于' },
]

const render = (shown: boolean): Promise<string> =>
  renderToString(h(DetailTabs, { tabs, active: 'overview', shown }))

describe('DetailTabs', () => {
  it('首屏隐藏：淡出类名 + aria-hidden + inert', async () => {
    const html = await render(false)
    expect(html).toContain('is-concealed')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toMatch(/\sinert(=|\s|>)/)
  })

  it('滚过 Hero 后出现，可交互', async () => {
    const html = await render(true)
    expect(html).not.toContain('is-concealed')
    expect(html).not.toContain('aria-hidden')
    expect(html).not.toMatch(/\sinert(=|\s|>)/)
    expect(html).toContain('剧集')
  })
})
