/**
 * 板块密码锁 feature 的公共出口：解锁界面（应用根组件挂载）、路由守卫（路由创建后安装）、
 * 侧栏锁图标的判断、设置分区（应用入口登记，桌面端才有）。
 */
import type { SettingsSection } from '@/features/settings'

export { default as SectionLockGate } from './SectionLockGate.vue'
export {
  installSectionLockGuard,
  isPathLocked,
  sectionLockAvailable,
} from './lock-state'

/** 「板块锁」设置分区；routes 是可锁板块的来源（路由表），由应用入口传入 */
export function sectionLockSettingsSection(
  routes: readonly unknown[]
): SettingsSection {
  return {
    id: 'section-lock',
    title: '板块锁',
    icon: 'lock',
    keywords: '密码 锁定 隐私 touch id 解锁 板块',
    load: () => import('./SectionLockSettings.vue'),
    props: { routes },
    order: 65,
  }
}
