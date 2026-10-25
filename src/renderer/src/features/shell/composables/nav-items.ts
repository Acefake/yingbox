/**
 * 侧栏与手机底部标签栏的导航项（纯函数，按当前路由与平台能力算出）。
 * 本地媒体、直播与网盘只在有本地片库的平台（桌面端）显示；其中「番号」（本地番号库）与 AV 一样只在成人模式下出现。
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
  /** 平台是否有本地片库（桌面端） */
  hasLocalLibrary: boolean
  /** 成人模式 */
  adultMode: boolean
  /** 追剧日历的未看新集数（侧栏角标） */
  calendarBadge?: number
}

const isOnlineTab = (state: NavState, tab?: string): boolean =>
  state.routeName === 'Online' &&
  (tab ? state.onlineTab === tab : !state.onlineTab)

/** 本地番号库入口（成人模式 + 有本地片库时） */
const JAV_ITEM = (state: NavState): NavItem => ({
  label: '番号',
  icon: 'tag',
  path: '/jav',
  active: state.routeName === 'Jav',
})

/** 侧栏导航分组 */
export function buildNavGroups(state: NavState): NavGroup[] {
  const groups: NavGroup[] = [
    {
      key: 'library',
      heading: '资料库',
      items: [
        { label: '首页', icon: 'home', path: '/', active: isOnlineTab(state) },
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
        },
        {
          label: '追剧日历',
          icon: 'calendar',
          path: '/calendar',
          active: state.routeName === 'Calendar',
          badge: state.calendarBadge ?? 0,
        },
      ],
    },
  ]
  const local: NavItem[] = []
  if (state.hasLocalLibrary) {
    local.push(
      {
        label: '电影',
        icon: 'movie',
        path: '/movie',
        active: state.routeName === 'Movie',
      },
      {
        label: '电视剧',
        icon: 'tv',
        path: '/tv',
        active: state.routeName === 'TV',
      }
    )
    if (state.adultMode) local.push(JAV_ITEM(state))
  }
  if (local.length)
    groups.push({
      key: 'local',
      heading: '本地媒体',
      divider: true,
      items: local,
    })
  if (state.hasLocalLibrary)
    groups.push({
      key: 'live',
      divider: true,
      items: [
        {
          label: '直播',
          icon: 'livePlay',
          path: '/live',
          active: state.routeName === 'Live',
        },
        {
          label: '网盘',
          icon: 'database',
          path: '/netdisk',
          active: state.routeName === 'Netdisk',
        },
      ],
    })
  if (state.adultMode)
    groups.push({
      key: 'adult',
      items: [
        {
          label: 'AV资源',
          icon: 'av',
          path: '/av',
          active: state.routeName === 'AV',
        },
      ],
    })
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
          {
            key: 'movie',
            label: '电影',
            icon: 'movie' as IconName,
            path: '/movie',
            active: state.routeName === 'Movie',
          },
          ...(state.adultMode ? [{ key: 'jav', ...JAV_ITEM(state) }] : []),
        ]
      : []),
    { key: 'menu', label: '菜单', icon: 'menu', path: '', active: menuOpen },
  ]
}
