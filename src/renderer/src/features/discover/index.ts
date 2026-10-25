/**
 * 库外发现 feature 的公共出口（只在桌面端可用）：
 * - AI 助手的 discover 动作：豆瓣筛选找片、和本地库去重（discoverTitles）、筛选串解析（parseDiscoverQuery）；
 * - 共用的「找 115 资源」候选面板（助手卡片下方内嵌）与首页豆瓣卡的弹窗（openDiscoverDialog）；
 * - 入库状态（未入库 / 入库中 / 已转存，等待入库 / 已入库），助手卡片与候选面板共用一份。
 * 主进程部分见 src/main/discover。
 */
export { discoverAvailable, openNetdiskSettings } from './api'
export { default as DiscoverCandidates } from './components/DiscoverCandidates.vue'
export { parseDiscoverQuery, requestedYears } from './discover-query'
export {
  type DiscoverTitle,
  findInLibrary,
  splitByLibrary,
  yearOf,
} from './discover-rules'
export { type DiscoverResult, discoverTitles } from './discover-search'
export {
  type DiscoverEntry,
  type DiscoverPhase,
  discoverEntry,
  phaseLabel,
} from './discover-state'
export { openDiscoverDialog } from './open-dialog'
