// @vitest-environment jsdom
import { type Component, createApp, h, nextTick } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItemSummary } from '../src/shared/library/ipc'

/**
 * 取景的接线：海报卡（UiPosterCard）与媒体库海报墙（PosterWall）的图片加载后交给 applyFocus，
 * 带上各自的框比例（竖版 2:3、横版 16:9、海报墙 1 : 1.5）。
 */

const applyFocus = vi.fn()
vi.mock('../src/renderer/src/services/thumbnails/focus', () => ({ applyFocus }))

beforeAll(() => {
  // jsdom 没有 ResizeObserver；海报墙按 clientWidth 排版
  globalThis.ResizeObserver = class {
    observe = (): void => undefined
    unobserve = (): void => undefined
    disconnect = (): void => undefined
  } as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800,
  })
})

beforeEach(() => {
  applyFocus.mockClear()
  document.body.innerHTML = ''
})

function mount(
  component: Component,
  props: Record<string, unknown>
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  createApp({ render: () => h(component, props) }).mount(host)
  return host
}

describe('UiPosterCard', () => {
  it.each([
    ['portrait', 2 / 3],
    ['landscape', 16 / 9],
  ] as const)(
    '%s 卡：图片加载后交给 applyFocus（框比例 %s）',
    async (shape, aspect) => {
      const { default: UiPosterCard } =
        await import('../src/renderer/src/components/ui/UiPosterCard.vue')
      const host = mount(UiPosterCard, {
        title: '片名',
        cover: 'https://img.test/a.jpg',
        shape,
      })
      const img = host.querySelector('img')!
      img.dispatchEvent(new Event('load'))
      expect(applyFocus).toHaveBeenCalledWith(img, aspect)
    }
  )
})

describe('PosterWall', () => {
  it('海报加载后交给 applyFocus（框比例 1 : 1.5）', async () => {
    const { PagedList } =
      await import('../src/renderer/src/features/library/wall/paged-list')
    const { default: PosterWall } =
      await import('../src/renderer/src/features/library/wall/PosterWall.vue')
    const item = {
      id: 7,
      title: 'SSIS-001',
      year: 2024,
      poster: `yingbox-media://image/${'c'.repeat(32)}`,
      rating: null,
      matchState: 'matched',
    } as unknown as LibraryItemSummary
    const list = new PagedList(
      async () => ({ items: [item], total: 1 }) as never,
      () => {}
    )
    await list.ensure(0, 1)
    const host = mount(PosterWall, {
      list,
      version: 1,
      count: 1,
      selected: new Set(),
      selectionVersion: 0,
      label: '番号库',
    })
    await nextTick()
    const img = host.querySelector('.lib-cell-media img') as HTMLImageElement
    expect(img).not.toBeNull()
    img.dispatchEvent(new Event('load'))
    expect(applyFocus).toHaveBeenCalledWith(img, 1 / 1.5)
  })
})
