import type { SettingsSection } from '@/features/settings'

/** 跨媒体库共享的识别、写出、整理和同步设置。 */
export const librarySettingsSection: SettingsSection = {
  id: 'library',
  title: '媒体库',
  icon: 'folder',
  keywords:
    '文件夹 添加 扫描 电影 剧集 动漫 综艺 纪录片 番号 webdav alist 115 自动入库 AI 识别 整理 模板 NFO 图片 网盘通知 进度同步',
  load: () => import('./LibraryGlobalSettings.vue'),
  order: 35,
}
