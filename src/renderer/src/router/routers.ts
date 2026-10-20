export const routes = [
  {
    path: '/amane', name: 'Amane',
    component: () => import('@/views/Amane/Index.vue'),
    meta: { title: 'Amane', description: '私人片库、扫描与刮削', adultOnly: true },
  },
  {
    path: '/',
    name: 'Online',
    component: () => import('@/views/online/Index.vue'),
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
    path: '/av',
    name: 'AV',
    component: () => import('@/views/av/Index.vue'),
    meta: {
      title: 'AV资源',
      description: '成人资源在线播放',
      adultOnly: true,
    },
  },

  {
    path: '/player-popout',
    name: 'PlayerPopout',
    component: () => import('@/views/PlayerPopout.vue'),
    meta: {
      title: '播放器',
      description: '独立播放窗口',
      popout: true,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
