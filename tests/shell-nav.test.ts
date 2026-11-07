import { describe, expect, it } from 'vitest'
import {
  type NavState,
  buildBottomNav,
  buildNavGroups,
  zhuijuLoginRedirect,
} from '../src/renderer/src/features/shell/composables/nav-items'
import { entryHotkey } from '../src/renderer/src/features/assistant/assistant-hotkey'
import { resolveHotkey } from '../src/renderer/src/features/player/hotkeys/hotkey-map'

const state = (patch: Partial<NavState> = {}): NavState => ({
  routeName: 'Online',
  onlineTab: undefined,
  hasLocalLibrary: true,
  hasNetdisk: true,
  netdiskReady: true,
  netdiskFailed: false,
  netdiskLoggedIn: true,
  adultMode: false,
  localPages: [
    { label: '电影', icon: 'movie', path: '/movie', routeNames: ['Movie'] },
    { label: '剧集', icon: 'tv', path: '/tv', routeNames: ['TV'] },
  ],
  ...patch,
})

describe('侧栏导航项', () => {
  it('桌面端（有网盘）：在线资源 + 追剧 + 本地媒体；成人模式多出成人资源', () => {
    const normal = buildNavGroups(state())
    expect(normal.map(g => g.key)).toEqual(['library', 'zhuiju', 'local'])
    expect(normal[2].items.map(i => i.path)).toEqual(['/movie', '/tv'])
    const adult = buildNavGroups(state({ adultMode: true }))
    expect(adult.map(g => g.key)).toEqual([
      'library',
      'zhuiju',
      'local',
      'adult',
    ])
    expect(adult[2].items.map(i => i.path)).toEqual(['/movie', '/tv'])
    expect(adult[3].heading).toBe('成人资源')
    expect(adult[3].items.map(i => i.path)).toEqual(['/jav', '/av'])
    const onJav = buildNavGroups(state({ adultMode: true, routeName: 'Jav' }))
    expect(onJav[3].items.map(i => i.active)).toEqual([true, false])
  })

  it('本地媒体：片库给的页面原样排列，选中态跟随路由', () => {
    const anime = {
      label: '动漫',
      icon: 'sparkle' as const,
      path: '/anime',
      routeNames: ['Anime'],
    }
    const base = state()
    const groups = buildNavGroups(
      state({
        adultMode: true,
        routeName: 'Anime',
        localPages: [...base.localPages, anime],
      })
    )
    expect(groups[2].items.map(i => i.path)).toEqual([
      '/movie',
      '/tv',
      '/anime',
    ])
    expect(groups[2].items.map(i => i.active)).toEqual([false, false, true])
  })

  it('直播在首页下面，选中态跟随路由', () => {
    const library = buildNavGroups(state({ routeName: 'Live' }))[0]
    expect(library.items.find(i => i.path === '/live')).toEqual({
      label: '直播',
      icon: 'broadcast',
      path: '/live',
      active: true,
    })
  })

  it('网盘入口移入追剧组：选中态跟随路由', () => {
    const netdisk = buildNavGroups(state({ routeName: 'Netdisk' })).find(
      g => g.key === 'zhuiju'
    )
    expect(netdisk?.items.find(i => i.path === '/netdisk')?.active).toBe(true)
    // 未登录：追剧组提供存储入口
    const loggedOut = buildNavGroups(state({ netdiskLoggedIn: false })).find(
      g => g.key === 'zhuiju'
    )
    expect(loggedOut?.items).toEqual([
      {
        label: '添加存储',
        icon: 'database',
        path: '/storage',
        active: false,
      },
    ])
    // 平台没有网盘能力：追剧组不出现
    expect(
      buildNavGroups(state({ hasNetdisk: false, netdiskLoggedIn: false })).map(
        g => g.key
      )
    ).not.toContain('zhuiju')
  })

  it('分组标题：在线资源、追剧、本地媒体和成人资源', () => {
    const groups = buildNavGroups(state({ adultMode: true }))
    expect(groups.map(g => g.heading)).toEqual([
      '在线资源',
      '追剧',
      '本地媒体',
      '成人资源',
    ])
  })

  it('没有本地片库时不显示本地媒体、直播和番号', () => {
    const groups = buildNavGroups(
      state({
        hasLocalLibrary: false,
        netdiskLoggedIn: false,
        adultMode: true,
      })
    )
    expect(groups.map(g => g.key)).toEqual(['library', 'zhuiju', 'adult'])
    expect(groups[0].items.map(i => i.path)).not.toContain('/live')
    expect(groups[1].items.map(i => i.label)).toEqual(['添加存储'])
    expect(groups[2].heading).toBe('成人资源')
    expect(groups[2].items.map(i => i.path)).toEqual(['/av'])
  })

  it('网盘登录后才显示搜剧与日历：未登录只留登录入口', () => {
    const loggedIn = buildNavGroups(state({ hasLocalLibrary: false }))
    expect(loggedIn.map(g => g.key)).toEqual(['library', 'zhuiju'])
    expect(loggedIn[1].items.map(i => i.path)).toEqual([
      '/netdisk',
      '/calendar',
      '/storage',
    ])
    expect(
      buildNavGroups(state({ hasAutograb: true }))
        .find(g => g.key === 'zhuiju')
        ?.items.map(i => i.path)
    ).toEqual(['/netdisk', '/calendar', '/autograb', '/storage'])
    const loggedOut = buildNavGroups(state({ netdiskLoggedIn: false }))
    expect(
      loggedOut.find(g => g.key === 'zhuiju')?.items.map(i => i.label)
    ).toEqual(['添加存储'])
  })

  it('选中态跟随路由与在线页标签', () => {
    const home = buildNavGroups(state())[0].items
    expect(home.map(i => i.active)).toEqual([true, false, false, false])
    const fav = buildNavGroups(state({ onlineTab: 'favorites' }))[0].items
    expect(fav.map(i => i.active)).toEqual([false, false, false, true])
    const movie = buildNavGroups(state({ routeName: 'Movie' }))
    expect(movie[0].items.some(i => i.active)).toBe(false)
    expect(movie[2].items[0].active).toBe(true)
  })

  it('账号还在读取时不显示追剧组；读取失败后留下登录入口', () => {
    expect(
      buildNavGroups(state({ netdiskReady: false })).map(g => g.key)
    ).toEqual(['library', 'local'])
    expect(
      buildNavGroups(
        state({
          netdiskReady: false,
          netdiskFailed: true,
          netdiskLoggedIn: false,
        })
      )
        .find(g => g.key === 'zhuiju')
        ?.items.map(i => i.label)
    ).toEqual(['添加存储'])
  })

  it('未登录打开追剧日历或自动追更时回到网盘登录页', () => {
    expect(zhuijuLoginRedirect('Calendar', false)).toBe('/netdisk')
    expect(zhuijuLoginRedirect('Autograb', false)).toBe('/netdisk')
    expect(zhuijuLoginRedirect('Calendar', true)).toBeNull()
    expect(zhuijuLoginRedirect('Online', false)).toBeNull()
  })

  it('追剧日历在追剧组，角标取未看新集数，选中态跟随路由', () => {
    const zhuiju = buildNavGroups(state({ calendarBadge: 3 })).find(
      g => g.key === 'zhuiju'
    )
    expect(zhuiju?.items.find(i => i.path === '/calendar')).toMatchObject({
      label: '追剧日历',
      icon: 'calendar',
      path: '/calendar',
      active: false,
      badge: 3,
    })
    const onCalendar = buildNavGroups(state({ routeName: 'Calendar' })).find(
      g => g.key === 'zhuiju'
    )
    expect(onCalendar?.items.find(i => i.path === '/calendar')).toMatchObject({
      active: true,
      badge: 0,
    })
    // 没有本地片库（网页端）也有追剧日历
    const web = buildNavGroups(state({ hasLocalLibrary: false })).find(
      g => g.key === 'zhuiju'
    )
    expect(web?.items.map(i => i.path)).toContain('/calendar')
  })

  it('手机底栏：菜单项无路径，选中态即抽屉是否打开', () => {
    const items = buildBottomNav(state({ hasLocalLibrary: false }), true)
    expect(items.map(i => i.key)).toEqual(['home', 'favorites', 'menu'])
    expect(items.at(-1)).toMatchObject({ path: '', active: true })
    // 底栏放本地媒体的第一个页面（没有条目时是「添加媒体库」入口）
    expect(buildBottomNav(state(), false).map(i => i.key)).toEqual([
      'home',
      'favorites',
      'local',
      'menu',
    ])
    // 番号只在成人模式 + 有本地片库时出现在底栏
    expect(
      buildBottomNav(state({ adultMode: true }), false).map(i => i.key)
    ).toEqual(['home', 'favorites', 'local', 'jav', 'menu'])
    expect(
      buildBottomNav(
        state({ adultMode: true, hasLocalLibrary: false }),
        false
      ).map(i => i.key)
    ).toEqual(['home', 'favorites', 'menu'])
  })
})

describe('统一入口快捷键', () => {
  const keys = (
    key: string,
    patch: Partial<KeyboardEventInit> & { target?: unknown } = {}
  ): Parameters<typeof entryHotkey>[0] =>
    ({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...patch,
    }) as Parameters<typeof entryHotkey>[0]

  it('Cmd/Ctrl+K 与 Cmd/Ctrl+Shift+K 都开合同一个入口，Cmd/Ctrl+F 只打开；播放器单键不受影响', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(entryHotkey(keys('k', mod))).toBe('toggle')
      expect(entryHotkey(keys('K', { ...mod, shiftKey: true }))).toBe('toggle')
      expect(entryHotkey(keys('f', mod))).toBe('open')
      expect(entryHotkey(keys('F', mod))).toBe('open')
      expect(entryHotkey(keys('f', { ...mod, shiftKey: true }))).toBeNull()
      expect(entryHotkey(keys('k', { ...mod, altKey: true }))).toBeNull()
      expect(entryHotkey(keys('k', { ...mod, repeat: true }))).toBeNull()
      expect(entryHotkey(keys('k', { ...mod, isComposing: true }))).toBeNull()
      // 播放器的 K（播放暂停）/ F（全屏）只认不带修饰键的单键
      expect(resolveHotkey(keys('k', mod))).toBeNull()
      expect(resolveHotkey(keys('f', mod))).toBeNull()
    }
    expect(entryHotkey(keys('k'))).toBeNull()
    expect(entryHotkey(keys('f'))).toBeNull()
  })

  it('焦点在别的对话框里（播放弹窗、确认框）时 Cmd/Ctrl+F 不抢，Cmd/Ctrl+K 照常开合', () => {
    const inDialog = {
      closest: (s: string) => (s === '[role="dialog"]' ? {} : null),
    }
    const outside = { closest: () => null }
    expect(
      entryHotkey(keys('f', { ctrlKey: true, target: inDialog }))
    ).toBeNull()
    expect(entryHotkey(keys('f', { ctrlKey: true, target: outside }))).toBe(
      'open'
    )
    expect(entryHotkey(keys('k', { ctrlKey: true, target: inDialog }))).toBe(
      'toggle'
    )
  })
})
