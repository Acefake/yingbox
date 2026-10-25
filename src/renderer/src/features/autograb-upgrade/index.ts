/**
 * 洗版与电影上线追踪 feature 的公共出口（只在桌面端可用）：
 * - AutograbTabs：追剧日历页追更区的「剧集 / 洗版 / 电影」标签，剧集栏放追更面板；
 * - MovieTrackButton：电影详情页操作区的「追踪上线」按钮。
 */
export { autograbUpgradeAvailable } from './api'
export { default as AutograbTabs } from './components/AutograbTabs.vue'
export { default as MovieTrackButton } from './components/MovieTrackButton.vue'
