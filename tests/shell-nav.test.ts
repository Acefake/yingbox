import { describe, expect, it } from 'vitest'
import {
  type NavState,
  buildBottomNav,
  buildNavGroups,
} from '../src/renderer/src/features/shell/composables/nav-items'
import {
  searchLocation,
  searchPlaceholder,
} from '../src/renderer/src/features/shell/composables/global-search'

const state = (patch: Partial<NavState> = {}): NavState => ({
  routeName: 'Online',
  onlineTab: undefined,
  hasLocalLibrary: true,
  adultMode: false,
  ...patch,
})

describe('侧栏导航项', () => {
  it('桌面端：资料库 + 本地媒体；成人模式多出 AV', () => {
    expect(buildNavGroups(state()).map(g => g.key)).toEqual([
      'library',
      'local',
    ])
    const adult = buildNavGroups(state({ adultMode: true }))
    expect(adult.map(g => g.key)).toEqual(['library', 'local', 'adult'])
    expect(adult[1].items.map(i => i.path)).toEqual(['/movie', '/tv'])
  })

  it('没有本地片库时不显示本地媒体组（成人模式下也不显示）', () => {
    const groups = buildNavGroups(
      state({ hasLocalLibrary: false, adultMode: true })
    )
    expect(groups.map(g => g.key)).toEqual(['library', 'adult'])
  })

  it('选中态跟随路由与在线页标签', () => {
    const home = buildNavGroups(state())[0].items
    expect(home.map(i => i.active)).toEqual([true, false, false])
    const fav = buildNavGroups(state({ onlineTab: 'favorites' }))[0].items
    expect(fav.map(i => i.active)).toEqual([false, false, true])
    const movie = buildNavGroups(state({ routeName: 'Movie' }))
    expect(movie[0].items.some(i => i.active)).toBe(false)
    expect(movie[1].items[0].active).toBe(true)
  })

  it('手机底栏：菜单项无路径，选中态即抽屉是否打开', () => {
    const items = buildBottomNav(state({ hasLocalLibrary: false }), true)
    expect(items.map(i => i.key)).toEqual(['home', 'favorites', 'menu'])
    expect(items.at(-1)).toMatchObject({ path: '', active: true })
    expect(buildBottomNav(state(), false).map(i => i.key)).toContain('movie')
  })
})

describe('全局搜索规则', () => {
  it('占位文字按页面区分，桌面端带快捷键提示', () => {
    expect(searchPlaceholder('Movie', true)).toBe('搜索本地电影')
    expect(searchPlaceholder('AV', false)).toBe('搜索 AV 资源（Ctrl + K）')
    expect(searchPlaceholder('Online', true)).toBe('搜索')
    expect(searchPlaceholder(undefined, false)).toBe(
      '搜索电影、电视剧（Ctrl + K）'
    )
  })

  it('本地片库页在本页按 ?q= 过滤，清空时去掉参数', () => {
    expect(searchLocation('TV', '/tv', '海')).toEqual({
      path: '/tv',
      query: { q: '海' },
    })
    expect(searchLocation('Movie', '/movie', '')).toEqual({
      path: '/movie',
      query: {},
    })
  })

  it('AV 页跳 AV 搜索标签，其余页面跳在线搜索标签', () => {
    expect(searchLocation('AV', '/av', 'x')).toEqual({
      path: '/av',
      query: { tab: 'search', q: 'x' },
    })
    expect(searchLocation('Online', '/', '')).toEqual({
      path: '/',
      query: { tab: 'search' },
    })
  })
})
