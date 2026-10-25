/**
 * 入库推送 feature 的公共出口：「新入库」设置分区（推送渠道、推送什么、自动中文字幕），由应用入口登记。
 * 推送与自动字幕都在桌面端主进程 / 媒体库引擎里（src/main/notify、src/main/library/subtitles），网页端不登记。
 */
import type { SettingsSection } from '@/features/settings'

/** 桌面端才有（主进程实现 notifications 域）。 */
export const notifyAvailable =
  typeof window !== 'undefined' && Boolean(window.api?.notifications)

/** 「新入库」设置分区 */
export const notifySettingsSection: SettingsSection = {
  id: 'arrivals',
  title: '新入库',
  icon: 'send',
  keywords:
    '推送 通知 系统通知 bark telegram 机器人 新集 新电影 追更 合并 字幕 中文字幕 opensubtitles 自动下载',
  load: () => import('./NotifySettings.vue'),
  order: 74,
}
