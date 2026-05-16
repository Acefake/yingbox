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
    component: () => import('@/views/online/index.vue'),
    meta: {
      title: '在线',
      description: '在线搜索与播放',
    },
  },
  {
    path: '/vod-test',
    name: 'VODTest',
    component: () => import('@/views/VODTestWindow.vue'),
    meta: {
      title: 'VOD测试',
      description: 'VOD解析器测试窗口',
    },
  },
  {
    path: '/movie',
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
  {
    path: '/av',
    name: 'AV',
    component: () => import('@/views/av/index.vue'),
    meta: {
      title: 'AV资源',
      description: '成人资源在线播放',
      adultOnly: true,
    },
  },
]
