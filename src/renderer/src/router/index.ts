/**
 * Vue Router 配置
 * 定义应用的路由规则和导航逻辑
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from './routers'

/**
 * 创建路由实例
 * 使用 Hash 模式以兼容 Electron 环境
 */
const router = createRouter({
  // 使用 Hash 模式，适合 Electron 应用
  history: createWebHashHistory(),
  routes,
  // 滚动行为配置
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  },
})

/**
 * 全局前置守卫
 * 在每次路由跳转前执行
 */
router.beforeEach((to, _from, next) => {
  // 设置页面标题
  if (to.meta?.title) {
    document.title = `PosterScraper - ${to.meta.title}`
  }
  next()
})

/**
 * 全局后置钩子
 * 在每次路由跳转后执行
 */
router.afterEach(to => {
  // 可以在这里添加页面访问统计等逻辑
  console.log(`导航到: ${to.path}`)
})

export default router
