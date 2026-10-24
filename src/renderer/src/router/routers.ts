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
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
