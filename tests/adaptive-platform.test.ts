import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { usePlatform } from '../src/renderer/src/composables/use-platform'

const viewport = reactive({ width: 390, height: 844, touch: true })
vi.mock('@/services/library-server', () => ({
  libraryServerState: () => ref('online'),
}))
vi.mock('@vueuse/core', () => ({
  useMediaQuery: (query: string) =>
    computed(() => {
      if (query.includes('pointer: coarse')) return viewport.touch
      return [...query.matchAll(/(min|max)-(width|height): (\d+)px/g)].every(
        ([, kind, axis, value]) => {
          const size = axis === 'width' ? viewport.width : viewport.height
          return kind === 'min' ? size >= Number(value) : size <= Number(value)
        }
      )
    }),
}))

afterEach(() => vi.unstubAllGlobals())

describe('设备窗口布局', () => {
  it('手机旋转后保持触摸布局', () => {
    Object.assign(viewport, { width: 390, height: 844, touch: true })
    const platform = usePlatform()
    expect(platform.isPhone.value).toBe(true)
    Object.assign(viewport, { width: 844, height: 390 })
    expect(platform.isPhone.value).toBe(true)
  })

  it('iPad 横竖屏和连接鼠标都使用平板布局，窄分屏使用手机布局', () => {
    Object.assign(viewport, { width: 768, height: 1024, touch: true })
    const platform = usePlatform()
    expect(platform.isTablet.value).toBe(true)
    Object.assign(viewport, { width: 1024, height: 768, touch: false })
    expect(platform.isTablet.value).toBe(true)
    viewport.width = 507
    expect(platform.isPhone.value).toBe(true)
    expect(platform.isTablet.value).toBe(false)
  })

  it('桌面客户端不因中等宽度进入平板布局', () => {
    vi.stubGlobal('window', { api: { win: {} } })
    Object.assign(viewport, { width: 1000, height: 700, touch: false })
    expect(usePlatform().isTablet.value).toBe(false)
  })
})
