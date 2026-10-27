/**
 * 洗版与电影上线追踪 feature 的公共出口（桌面端，或连着片库服务的网页端可用）：
 * - AutograbTabs：追剧日历页追更区的「剧集 / 洗版 / 电影」标签，剧集栏放追更面板；
 * - MovieTrackButton：电影详情页操作区的「追踪上线」按钮；
 * - autograbSettingsSection：设置 · 自动追更（剧集 / 电影的全局策略），由应用入口登记。
 */
import type { SettingsSection } from '@/features/settings'

export { autograbUpgradeAvailable } from './api'

/** 「自动追更」设置分区：剧集 / 电影的全局方式、默认目录与资源偏好（桌面端，或连着片库服务的网页端登记） */
export const autograbSettingsSection: SettingsSection = {
  id: 'autograb',
  title: '自动追更',
  icon: 'refresh',
  keywords:
    '追更 自动 全自动 待确认 不追 新剧 确认 电影 剧集 默认目录 资源 偏好 画质 均衡 省空间 分辨率 4K 1080p 杜比视界 HDR 中文字幕 中字 体积 偏好词 排除词',
  load: () => import('./settings/AutograbSettings.vue'),
  order: 73,
}
export { default as AutograbTabs } from './components/AutograbTabs.vue'
export { default as MovieTrackButton } from './components/MovieTrackButton.vue'
