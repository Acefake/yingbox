// @vitest-environment jsdom
import { type Component, createApp, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiMediaRow from '@/components/ui/UiMediaRow.vue'

vi.mock('@/services/thumbnails', () => ({
  webImageSrc: (src: string) => src,
  thumbSrc: (src: string) => src,
  pickThumbWidth: () => 200,
  applyFocus: vi.fn(),
}))
vi.mock('@/components/ui/hover-preview', () => ({ useCardPreview: vi.fn() }))

function mount(
  component: Component,
  props: Record<string, unknown>
): { el: HTMLElement; unmount: () => void } {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(component, props) })
  app.mount(el)
  return { el, unmount: () => app.unmount() }
}

describe('统一评分展示', () => {
  it.each(['豆瓣 8.6', 'TMDB 7.5'])(
    '海报卡与结果行共用来源角标：%s',
    rating => {
      for (const component of [UiPosterCard, UiMediaRow]) {
        const wrapper = mount(component, { title: '影片', rating })
        const badge = wrapper.el.querySelector('[role="img"]')!
        expect(badge.getAttribute('aria-label')).toBe(rating)
        expect(badge.querySelector('svg')).not.toBeNull()
        expect(badge.textContent).not.toContain('★')
        wrapper.unmount()
      }
    }
  )

  it('未知来源没有品牌标识，空评分不占位', () => {
    const wrapper = mount(UiRatingBadge, { rating: 'IMDb 8.2', inline: true })
    expect(wrapper.el.textContent).toBe('IMDb 8.2')
    expect(wrapper.el.querySelector('svg')).toBeNull()
    wrapper.unmount()
    const empty = mount(UiRatingBadge, { rating: 0 })
    expect(empty.el.querySelector('[role="img"]')).toBeNull()
    empty.unmount()
  })
})
