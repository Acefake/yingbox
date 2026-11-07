/**
 * 侧栏与手机底部标签栏的导航项（纯函数，按当前路由与平台能力算出）。
 * 「在线资源」：首页、直播（有片库时，紧挨首页）、最近播放、我的收藏。
 * 「追剧」包含存储入口；115 登录后显示网盘搜剧、追剧日历与自动追更。
 * 本地媒体由片库给出（有条目的电影 / 剧集 / 动漫 / 综艺 / 纪录片，都没有时一个「添加媒体库」入口）；
 * 「成人资源」只在成人模式出现：有片库时含番号，另有 AV。
 */
import type { IconName } from '@/components/ui/icons'

/** 一个导航项 */
export interface NavItem {
  label: string
  icon: IconName
  /** 目标路由；手机底栏的「菜单」为空串，点击打开侧栏抽屉 */
  path: string
  active: boolean
  /** 尾部数字角标（追剧日历的未看新集数）；0 或缺省不显示 */
  badge?: number
}

/** 侧栏里的一组导航项 */
export interface NavGroup {
  key: string
  heading?: string
  divider?: boolean
  items: NavItem[]
}

/** 底部标签项（多一个稳定的 key） */
export interface BottomNavItem extends NavItem {
  key: string
}

/** 计算导航项需要的当前状态 */
export interface NavState {
  /** 当前路由名 */
  routeName: string | undefined
  /** 在线页的 ?tab=（无则为 undefined） */
  onlineTab: string | undefined
  /** 平台是否有本地片库（桌面端，或网页端连着片库服务） */
  hasLocalLibrary: boolean
  /** 平台能否登录 115（桌面端，或网页端连着片库服务） */
  hasNetdisk: boolean
  /** 115 账号是否已经确认。还在读时不显示追剧组，避免先闪出登录入口 */
  netdiskReady: boolean
  /** 还没确认，且最近一次读取失败。这时留下存储入口，用来打开重试页 */
  netdiskFailed: boolean
  /** 115 已登录。网盘搜剧、追剧日历、自动追更只在登录后出现 */
  netdiskLoggedIn: boolean
  /** 成人模式 */
  adultMode: boolean
  /** 追剧日历的未看新集数（侧栏角标） */
  calendarBadge?: number
  /** 能用自动追更（桌面端，或网页端连着片库服务） */
  hasAutograb?: boolean
  /** 自动追更页要用户处理的集数（侧栏角标） */
  autograbBadge?: number
  /** 本地媒体里的普通片库页面（片库按有没有条目算好，见 features/library 的 useLocalNavPages） */
  localPages: readonly LocalPage[]
}

/** 侧栏里一个本地媒体页面 */
export interface LocalPage {
  label: string
  icon: IconName
  path: string
  /** 在这些路由上算选中 */
  routeNames: readonly string[]
}

const isOnlineTab = (state: NavState, tab?: string): boolean =>
  state.routeName === 'Online' &&
  (tab ? state.onlineTab === tab : !state.onlineTab)

const localItem = (state: NavState, page: LocalPage): NavItem => ({
  label: page.label,
  icon: page.icon,
  path: page.path,
  active:
    state.routeName !== undefined && page.routeNames.includes(state.routeName),
})

/** 本地番号库入口（成人模式 + 有本地片库时） */
const JAV_ITEM = (state: NavState): NavItem => ({
  label: '番号',
  icon: 'tag',
  path: '/jav',
  active: state.routeName === 'Jav',
})

/** 未登录时，追剧日历和自动追更进不去，回到登录页。 */
export function zhuijuLoginRedirect(
  routeName: unknown,
  loggedIn: boolean
): '/netdisk' | null {
  if (loggedIn || (routeName !== 'Calendar' && routeName !== 'Autograb'))
    return null
  return '/netdisk'
}

/** 追剧分组：存储管理始终可达；需要 115 登录的功能按账号状态显示。 */
function zhuijuItems(state: NavState): NavItem[] {
  if (!state.netdiskReady && !state.netdiskFailed) return []
  if (state.netdiskLoggedIn) {
    const items: NavItem[] = [
      {
        label: '网盘搜剧',
        icon: 'cloud',
        path: '/netdisk',
        active: state.routeName === 'Netdisk',
      },
      {
        label: '追剧日历',
        icon: 'calendar',
        path: '/calendar',
        active: state.routeName === 'Calendar',
        badge: state.calendarBadge ?? 0,
      },
    ]
    if (state.hasAutograb)
      items.push({
        label: '自动追更',
        icon: 'refresh',
        path: '/autograb',
        active: state.routeName === 'Autograb',
        badge: state.autograbBadge ?? 0,
      })
    items.push({
      label: '添加存储',
      icon: 'database',
      path: '/storage',
      active: state.routeName === 'Storage',
    })
    return items
  }
  if (!state.hasNetdisk) return []
  return [
    {
      label: '添加存储',
      icon: 'database',
      path: '/storage',
      active: state.routeName === 'Storage',
    },
  ]
}

/** 侧栏导航分组 */
export function buildNavGroups(state: NavState): NavGroup[] {
  const libraryItems: NavItem[] = [
    { label: '首页', icon: 'home', path: '/', active: isOnlineTab(state) },
  ]
  if (state.hasLocalLibrary)
    libraryItems.push({
      label: '直播',
      icon: 'broadcast',
      path: '/live',
      active: state.routeName === 'Live',
    })
  libraryItems.push(
    {
      label: '最近播放',
      icon: 'history',
      path: '/?tab=recent',
      active: isOnlineTab(state, 'recent'),
    },
    {
      label: '我的收藏',
      icon: 'heart',
      path: '/?tab=favorites',
      active: isOnlineTab(state, 'favorites'),
    }
  )
  const groups: NavGroup[] = [
    {
      key: 'library',
      heading: '在线资源',
      items: libraryItems,
    },
  ]
  const zhuiju = zhuijuItems(state)
  if (zhuiju.length)
    groups.push({ key: 'zhuiju', heading: '追剧', items: zhuiju })
  const local: NavItem[] = []
  if (state.hasLocalLibrary)
    local.push(...state.localPages.map(page => localItem(state, page)))
  if (local.length)
    groups.push({
      key: 'local',
      heading: '本地媒体',
      items: local,
    })
  if (state.adultMode) {
    const adult: NavItem[] = []
    if (state.hasLocalLibrary) adult.push(JAV_ITEM(state))
    adult.push({
      label: 'AV资源',
      icon: 'av',
      path: '/av',
      active: state.routeName === 'AV',
    })
    groups.push({ key: 'adult', heading: '成人资源', items: adult })
  }
  return groups
}

/** 手机底部标签栏；menuOpen 为侧栏抽屉是否打开（「菜单」项的选中态） */
export function buildBottomNav(
  state: NavState,
  menuOpen: boolean
): BottomNavItem[] {
  return [
    {
      key: 'home',
      label: '首页',
      icon: 'home',
      path: '/',
      active: isOnlineTab(state),
    },
    {
      key: 'favorites',
      label: '收藏',
      icon: 'heart',
      path: '/?tab=favorites',
      active: isOnlineTab(state, 'favorites'),
    },
    ...(state.hasLocalLibrary
      ? [
          ...state.localPages
            .slice(0, 1)
            .map(page => ({ key: 'local', ...localItem(state, page) })),
          ...(state.adultMode ? [{ key: 'jav', ...JAV_ITEM(state) }] : []),
        ]
      : []),
    { key: 'menu', label: '菜单', icon: 'menu', path: '', active: menuOpen },
  ]
}
