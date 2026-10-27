import type { SettingsSection } from '@/features/settings'

/** 跨媒体库共享的识别、写出、整理和同步设置。 */
export const librarySettingsSection: SettingsSection = {
  id: 'library',
  title: '媒体库',
  icon: 'folder',
  keywords: '电影 剧集 番号 AI 识别 整理 模板 NFO 图片 网盘通知 进度同步',
  load: () => import('./LibraryGlobalSettings.vue'),
  order: 35,
}
