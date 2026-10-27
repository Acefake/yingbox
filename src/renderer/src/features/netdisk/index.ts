/**
 * 网盘 feature 的公共出口：「网盘」设置分区（PanSou 地址、115 扫码登录、转存目标文件夹），由应用入口登记。
 * 搜索页 views/NetdiskView.vue 由路由表直接懒加载。转存目标胶囊（默认目录 / 最近使用 / 115 目录树）给追更、电影追踪、洗版面板与设置 · 自动追更选文件夹；目录树与「打开设置 · 网盘」给追更面板切全自动前补选文件夹用。
 */
import type { SettingsSection } from '@/features/settings'

import { netdiskAvailable, openNetdiskSettings } from './api'

/** 「网盘」设置分区（桌面端，或连着片库服务的网页端登记） */
export const netdiskSettingsSection: SettingsSection = {
  id: 'netdisk',
  title: '网盘',
  icon: 'database',
  keywords:
    '网盘 115 PanSou Torznab Prowlarr Jackett 磁力 离线 搜索 扫码 登录 转存 文件夹 电影 剧集 默认目录',
  load: () => import('./components/NetdiskSettings.vue'),
  order: 72,
}

export { netdiskAvailable, openNetdiskSettings }
export { default as FolderTree } from './components/FolderTree.vue'
export { default as TargetFolderPill } from './components/TargetFolderPill.vue'
export type { FolderPick, FolderPreset } from './utils/transfer-target'
