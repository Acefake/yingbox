export const routes = [
  {
    path: '/online-detail',
    name: 'OnlineDetail',
    component: () => import('@/views/online/DetailWindow.vue'),
    meta: { title: '详情' },
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
    component: () => import('@/views/movie/Index.vue'),
    meta: {
      title: '电影',
      description: '电影文件管理和刮削功能',
    },
  },
  {
    path: '/tv',
    name: 'TV',
    component: () => import('@/views/tv/Index.vue'),
    meta: {
      title: 'TV',
      description: 'TV文件管理和刮削功能',
    },
  },
]
