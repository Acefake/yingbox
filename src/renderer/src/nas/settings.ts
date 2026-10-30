/** NAS 设置只登记用户可在浏览器中使用的功能。 */
import type { SettingsSection } from '@/features/settings'

/** 片库、网盘、追更和通知分区由 NAS 应用入口登记。 */
export const nasCoreSections: SettingsSection[] = [
  {
    id: 'appearance',
    title: '外观',
    icon: 'sun',
    keywords: '主题 深色 浅色 预览 防剧透',
    order: 10,
    load: () => import('@/features/settings/sections/AppearanceSettings.vue'),
  },
  {
    id: 'scrape',
    title: '刮削',
    icon: 'download',
    keywords: 'TMDB 令牌 语言 图片 海报',
    order: 30,
    load: () => import('@/features/settings/sections/ScrapeSettings.vue'),
  },
  {
    id: 'player',
    title: '播放器',
    icon: 'play',
    keywords: '播放 浏览器 片头',
    order: 60,
    load: () => import('./settings/PlayerSettings.vue'),
  },
]
