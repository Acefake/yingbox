/**
 * Vue Router 配置
 * 定义应用的路由规则和导航逻辑
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from '@/router/routers'
import { getSetting } from '@/features/settings'
import { adultRedirect } from '@/router/adult-guard'
import { installSectionLockGuard } from '@/features/section-lock'

/**
 * 创建路由实例
 * 使用 Hash 模式以兼容 Electron 环境
 */
const router = createRouter({
  // 使用 Hash 模式，适合 Electron 应用
  history: createWebHashHistory(),
  routes,
  // 滚动行为配置
  scrollBehavior(_to, _from, savedPosition) {
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
  // 成人页面（番号库、AV）在成人模式关闭时挡回首页：直接打开的旧链接也不会露出内容
  const redirect = adultRedirect(to, getSetting('app.adultMode'))
  if (redirect) {
    next(redirect)
    return
  }
  // 设置页面标题
  if (to.meta?.title) {
    document.title = `影盒 - ${to.meta.title}`
  }
  next()
})

// 板块密码锁：进入已锁定的板块前要求解锁（排在成人模式守卫之后）
installSectionLockGuard(router)

/**
 * 全局后置钩子
 * 在每次路由跳转后执行
 */
router.afterEach(to => {
  // 可以在这里添加页面访问统计等逻辑
  console.log(`导航到: ${to.path}`)
})

export default router
