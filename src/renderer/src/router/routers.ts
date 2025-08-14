export const routes = [
  {
    path: '/',
    name: 'Movie',
    component: () => import('@/views/Movie/index.vue'),
    meta: {
      title: '电影',
      description: '电影文件管理和刮削功能',
    },
  },
  {
    path: '/tv',
    name: 'TV',
    component: () => import('@/views/TV/index.vue'),
    meta: {
      title: 'TV',
      description: 'TV文件管理和刮削功能',
    },
  },
]
