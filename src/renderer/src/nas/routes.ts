/**
 * 路由表（应用组合层）。页面组件按需加载，所以这里直接指向各 feature 的视图文件，
 * 不经 index.ts——组合层不受 feature 边界规则约束，以保留按路由拆包。
 */
export const routes = [
  {
    path: '/search',
    name: 'Search',
    component: () => import('@/features/search/SearchPage.vue'),
    meta: { title: '搜索' },
  },
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
    path: '/anime',
    name: 'Anime',
    component: () => import('@/features/library/AnimeLibraryPage.vue'),
    meta: {
      title: '动漫',
      description: '本地片库里的动画剧集与动画电影',
    },
  },
  {
    path: '/variety',
    name: 'Variety',
    component: () => import('@/features/library/VarietyLibraryPage.vue'),
    meta: {
      title: '综艺',
      description: '本地片库里的真人秀与脱口秀',
    },
  },
  {
    path: '/documentary',
    name: 'Documentary',
    component: () => import('@/features/library/DocumentaryLibraryPage.vue'),
    meta: {
      title: '纪录片',
      description: '本地片库里的纪录片',
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
    path: '/autograb',
    name: 'Autograb',
    component: () =>
      import('@/features/autograb-upgrade/views/AutograbPage.vue'),
    meta: {
      title: '自动追更',
      description: '剧集追更、版本升级和电影上线追踪',
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
