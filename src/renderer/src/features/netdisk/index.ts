/**
 * 网盘 feature 的公共出口：「网盘」设置分区（PanSou 地址、115 扫码登录、转存目标文件夹），由应用入口登记。
 * 搜索页 views/NetdiskView.vue 由路由表直接懒加载。115 文件夹选择器给追更面板选每部剧的文件夹。
 */
import type { SettingsSection } from '@/features/settings'

import { netdiskAvailable } from './api'

/** 「网盘」设置分区（只在桌面端登记） */
export const netdiskSettingsSection: SettingsSection = {
  id: 'netdisk',
  title: '网盘',
  icon: 'database',
  tint: 'blue',
  keywords: '网盘 115 PanSou 搜索 扫码 登录 转存 文件夹',
  load: () => import('./components/NetdiskSettings.vue'),
  order: 72,
}

export { netdiskAvailable }
export { default as NetdiskFolderPicker } from './components/NetdiskFolderPicker.vue'
