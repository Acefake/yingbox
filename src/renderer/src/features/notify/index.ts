/**
 * 入库推送 feature 的公共出口：「新入库」设置分区（推送渠道、推送什么、自动中文字幕），由应用入口登记。
 * 桌面推送经主进程，网页推送经 NAS 服务；自动字幕的界面设置只在桌面端提供。
 */
import type { SettingsSection } from '@/features/settings'
import { notificationApi } from './api'

/** 当前运行环境有推送接口（桌面端或 NAS）。 */
export const notifyAvailable = Boolean(notificationApi())

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
