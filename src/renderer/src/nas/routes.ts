/**
 * 路由表（应用组合层）。页面组件按需加载，所以这里直接指向各 feature 的视图文件，
 * 不经 index.ts——组合层不受 feature 边界规则约束，以保留按路由拆包。
 */
export const routes = [
  {
    path: '/',
    name: 'Online',
    component: () => import('@/features/online/views/OnlineView.vue'),
    meta: {
      title: '在线',
      description: '在线搜索与播放',
    },
  },
  {
    path: '/movie',
    name: 'Movie',
    component: () => import('@/features/library/MovieLibraryPage.vue'),
    meta: {
      title: '电影',
      description: '本地电影库',
    },
  },
  {
    path: '/tv',
    name: 'TV',
    component: () => import('@/features/library/TvLibraryPage.vue'),
    meta: {
      title: '剧集',
      description: '本地剧集库',
    },
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import('@/features/calendar/views/CalendarView.vue'),
    meta: {
      title: '追剧日历',
      description: '媒体库与在线剧集按播出日期排成一周',
    },
  },
  {
    path: '/live',
    name: 'Live',
    component: () => import('@/features/live/views/LiveView.vue'),
    meta: {
      title: '直播',
      description: 'IPTV 直播与节目单',
    },
  },
  {
    path: '/netdisk',
    name: 'Netdisk',
    component: () => import('@/features/netdisk/views/NetdiskView.vue'),
    meta: {
      title: '网盘',
      description: '网盘搜索与 115 转存',
    },
  },

  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

export const nasRoutes = routes
