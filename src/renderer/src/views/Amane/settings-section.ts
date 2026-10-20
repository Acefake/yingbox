import type { SettingsSection } from '@/features/settings/registry'

/** Amane 在设置面板里的分区（成人模式下显示），由应用入口登记 */
export const amaneSettingsSection: SettingsSection = {
  id: 'amane',
  title: 'Amane',
  icon: 'movie',
  keywords: 'Amane 片库 连接 存储 刮削 智能体 水印 超分',
  load: () => import('./AmaneSettingsSection.vue'),
  adultOnly: true,
}
