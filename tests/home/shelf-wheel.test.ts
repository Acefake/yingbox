// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import UiShelf from '../../src/renderer/src/components/ui/UiShelf.vue'

it('首页滚轮交给页面，其他页面保持原有横向滚动和箭头翻页', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h('div', [
        h('div', { 'data-shelf-wheel': 'page' }, [
          h(UiShelf, { title: '首页' }, () => h('div', '卡片')),
        ]),
        h(UiShelf, { title: '其他' }, () => h('div', '卡片')),
      ]),
  })
  app.mount(host)
  await nextTick()
  const tracks = [...host.querySelectorAll<HTMLElement>('.yb-shelf-track')]
  for (const track of tracks) {
    Object.defineProperties(track, {
      clientWidth: { value: 300 },
      scrollWidth: { value: 900 },
    })
    track.scrollBy = vi.fn()
  }
  const wheel = (): WheelEvent =>
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    })
  const homeWheel = wheel()
  tracks[0].dispatchEvent(homeWheel)
  expect(homeWheel.defaultPrevented).toBe(false)
  expect(tracks[0].scrollBy).not.toHaveBeenCalled()
  const otherWheel = wheel()
  tracks[1].dispatchEvent(otherWheel)
  expect(otherWheel.defaultPrevented).toBe(true)
  expect(tracks[1].scrollBy).toHaveBeenCalledOnce()
  tracks[0].dispatchEvent(new Event('scroll'))
  await nextTick()
  const next = host.querySelector<HTMLButtonElement>(
    '[data-shelf-wheel="page"] [aria-label="向右滚动"]'
  )!
  next.click()
  expect(tracks[0].scrollBy).toHaveBeenCalledOnce()
  app.unmount()
  host.remove()
})
