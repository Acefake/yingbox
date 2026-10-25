/**
 * 下载 feature 的公共出口：下载列表视图与「下载」设置分区。
 */
import type { SettingsSection } from '@/features/settings'

export { default as DownloadsView } from './components/DownloadsView.vue'

/** 「下载」设置分区（下载目录；下载入口在 AV 页，所以只在成人模式下显示），由应用入口登记 */
export const downloadSettingsSection: SettingsSection = {
  id: 'download',
  title: '下载',
  icon: 'folder',
  tint: 'green',
  keywords: '下载目录 文件夹 保存位置 番号',
  load: () => import('./components/DownloadSettings.vue'),
  adultOnly: true,
  order: 75,
}
