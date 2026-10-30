/** NAS 路由只提供片库与网盘；失效的完整版本链接回到片库。 */
import type { RouteRecordRaw } from 'vue-router'

/** 页面组件保持懒加载，避免引入桌面和在线播放入口。 */
export const nasRoutes: RouteRecordRaw[] = [
  {
    path: '/search',
    name: 'Search',
    component: () => import('@/features/search/SearchPage.vue'),
    meta: { title: '搜索' },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('./pages/HomePage.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/movie',
    name: 'Movie',
    component: () => import('@/features/library/MovieLibraryPage.vue'),
    meta: { title: '电影' },
  },
  {
    path: '/tv',
    name: 'TV',
    component: () => import('@/features/library/TvLibraryPage.vue'),
    meta: { title: '剧集' },
  },
  {
    path: '/jav',
    name: 'Jav',
    component: () => import('@/features/library/JavLibraryPage.vue'),
    meta: { title: '番号', adultOnly: true },
  },
  {
    path: '/netdisk',
    name: 'Netdisk',
    component: () => import('@/features/netdisk/views/NetdiskView.vue'),
    meta: { title: '网盘' },
  },
  {
    path: '/netdisk/manage',
    component: () => import('./pages/AutomationPage.vue'),
    meta: { title: '追更与洗版' },
  },
  {
    path: '/tasks',
    component: () => import('./pages/TasksPage.vue'),
    meta: { title: '片库任务' },
  },
  {
    path: '/calendar',
    redirect: to => (to.query.autograb ? '/netdisk/manage' : '/movie'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/movie' },
]
