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
    path: '/jav',
    name: 'Jav',
    component: () => import('@/features/library/JavLibraryPage.vue'),
    meta: {
      title: '番号',
      description: '本地番号库（刮削番号站点）',
      adultOnly: true,
    },
  },
  {
    path: '/av',
    name: 'AV',
    component: () => import('@/features/av/views/AvView.vue'),
    meta: {
      title: 'AV资源',
      description: '成人资源在线播放',
      adultOnly: true,
    },
  },

  {
    path: '/player-popout',
    name: 'PlayerPopout',
    component: () => import('@/features/player/views/PlayerPopout.vue'),
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
