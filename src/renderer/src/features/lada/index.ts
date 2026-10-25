/**
 * Lada（去马赛克）feature 的公共出口：任务状态与设置分区。
 */
import type { SettingsSection } from '@/features/settings'

export { useLadaTasks } from './composables/use-lada-tasks'

/** Lada 在设置面板里的分区（成人模式下显示），由应用入口登记 */
export const ladaSettingsSection: SettingsSection = {
  id: 'lada',
  title: '去马赛克',
  icon: 'wand',
  tint: 'gray',
  keywords: 'lada 去码 马赛克 无码 mpv 路径',
  load: () => import('./components/LadaSettings.vue'),
  adultOnly: true,
  order: 70,
}
