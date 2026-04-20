export const routes = [
  {
    path: '/',
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
