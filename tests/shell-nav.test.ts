import { describe, expect, it } from 'vitest'
import {
  type NavState,
  buildBottomNav,
  buildNavGroups,
} from '../src/renderer/src/features/shell/composables/nav-items'
import {
  filtersInPlace,
  searchLocation,
  searchPlaceholder,
} from '../src/renderer/src/features/shell/composables/global-search'

const state = (patch: Partial<NavState> = {}): NavState => ({
  routeName: 'Online',
  onlineTab: undefined,
  hasLocalLibrary: true,
  hasNetdisk: true,
  adultMode: false,
  ...patch,
})

describe('侧栏导航项', () => {
  it('桌面端：资料库 + 本地媒体 + 直播；成人模式多出番号与 AV', () => {
    const normal = buildNavGroups(state())
    expect(normal.map(g => g.key)).toEqual(['library', 'local', 'live'])
    expect(normal[1].items.map(i => i.path)).toEqual(['/movie', '/tv'])
    const adult = buildNavGroups(state({ adultMode: true }))
    expect(adult.map(g => g.key)).toEqual(['library', 'local', 'live', 'adult'])
    expect(adult[1].items.map(i => i.path)).toEqual(['/movie', '/tv', '/jav'])
    expect(adult[1].items[2]).toMatchObject({ label: '番号', icon: 'tag' })
    const onJav = buildNavGroups(state({ adultMode: true, routeName: 'Jav' }))
    expect(onJav[1].items.map(i => i.active)).toEqual([false, false, true])
  })

  it('直播与网盘入口：桌面端显示，选中态跟随路由', () => {
    const live = buildNavGroups(state({ routeName: 'Live' })).find(
      g => g.key === 'live'
    )
    expect(live?.items).toEqual([
      { label: '直播', icon: 'livePlay', path: '/live', active: true },
      { label: '网盘', icon: 'database', path: '/netdisk', active: false },
    ])
    const netdisk = buildNavGroups(state({ routeName: 'Netdisk' })).find(
      g => g.key === 'live'
    )
    expect(netdisk?.items.map(i => i.active)).toEqual([false, true])
  })

  it('没有本地片库时不显示本地媒体组与直播（成人模式下也不显示）', () => {
    const groups = buildNavGroups(
      state({ hasLocalLibrary: false, hasNetdisk: false, adultMode: true })
    )
    expect(groups.map(g => g.key)).toEqual(['library', 'adult'])
  })

  it('网盘入口只看桌面端能力：没有本地片库也可达，网页端连着片库也不显示', () => {
    const noLibrary = buildNavGroups(state({ hasLocalLibrary: false }))
    expect(noLibrary.map(g => g.key)).toEqual(['library', 'live'])
    expect(noLibrary[1].items).toEqual([
      { label: '网盘', icon: 'database', path: '/netdisk', active: false },
    ])
    const web = buildNavGroups(state({ hasNetdisk: false }))
    expect(web.find(g => g.key === 'live')?.items.map(i => i.path)).toEqual([
      '/live',
    ])
  })

  it('选中态跟随路由与在线页标签', () => {
    const home = buildNavGroups(state())[0].items
    expect(home.map(i => i.active)).toEqual([true, false, false, false])
    const fav = buildNavGroups(state({ onlineTab: 'favorites' }))[0].items
    expect(fav.map(i => i.active)).toEqual([false, false, true, false])
    const movie = buildNavGroups(state({ routeName: 'Movie' }))
    expect(movie[0].items.some(i => i.active)).toBe(false)
    expect(movie[1].items[0].active).toBe(true)
  })

  it('资料库组末尾是追剧日历，角标取未看新集数，选中态跟随路由', () => {
    const items = buildNavGroups(state({ calendarBadge: 3 }))[0].items
    expect(items.at(-1)).toMatchObject({
      label: '追剧日历',
      icon: 'calendar',
      path: '/calendar',
      active: false,
      badge: 3,
    })
    const onCalendar = buildNavGroups(state({ routeName: 'Calendar' }))[0]
    expect(onCalendar.items.at(-1)).toMatchObject({ active: true, badge: 0 })
    // 没有本地片库（网页端）也有追剧日历：在线剧同样纳入
    const web = buildNavGroups(state({ hasLocalLibrary: false }))[0].items
    expect(web.map(i => i.path)).toContain('/calendar')
  })

  it('手机底栏：菜单项无路径，选中态即抽屉是否打开', () => {
    const items = buildBottomNav(state({ hasLocalLibrary: false }), true)
    expect(items.map(i => i.key)).toEqual(['home', 'favorites', 'menu'])
    expect(items.at(-1)).toMatchObject({ path: '', active: true })
    expect(buildBottomNav(state(), false).map(i => i.key)).toEqual([
      'home',
      'favorites',
      'movie',
      'menu',
    ])
    // 番号只在成人模式 + 有本地片库时出现在底栏
    expect(
      buildBottomNav(state({ adultMode: true }), false).map(i => i.key)
    ).toEqual(['home', 'favorites', 'movie', 'jav', 'menu'])
    expect(
      buildBottomNav(
        state({ adultMode: true, hasLocalLibrary: false }),
        false
      ).map(i => i.key)
    ).toEqual(['home', 'favorites', 'menu'])
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

  it('番号页在本页按 ?q= 过滤', () => {
    expect(searchPlaceholder('Jav', true)).toBe('搜索本地番号')
    expect(searchLocation('Jav', '/jav', 'ABC')).toEqual({
      path: '/jav',
      query: { q: 'ABC' },
    })
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

  it('只有本地片库页边输入边过滤', () => {
    expect(filtersInPlace('Movie')).toBe(true)
    expect(filtersInPlace('TV')).toBe(true)
    expect(filtersInPlace('Jav')).toBe(true)
    expect(filtersInPlace('AV')).toBe(false)
    expect(filtersInPlace('Online')).toBe(false)
    expect(filtersInPlace(undefined)).toBe(false)
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
