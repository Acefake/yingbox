/**
 * 本地媒体库 feature 的公共出口（页面本身由 router 按需加载，不经这里）。
 */
export {
  type LibraryActivity,
  useIdentifyActivity,
} from './state/use-libraries'
/** 追剧日历用：播出数据、播放某一集、图片地址、文件进度键 */
export {
  fetchCalendarEpisodes,
  libraryImage,
  libraryProgressKey,
  playLibraryEpisode,
} from './detail/calendar-links'
/** AI 助手用：「今晚看什么」推荐与播放 */
export {
  type TonightSuggestion,
  type TonightSuggestions,
  playTonightPick,
  suggestTonight,
} from './tonight/tonight-play'
/** AI 助手技能包用：按来源查条目、随机一条、播放条目、取视频文件 */
export {
  type LibraryLookup,
  findLibraryItems,
  libraryItemVideo,
  libraryPoster,
  playLibraryItem,
  randomLibraryItem,
} from './detail/assistant-links'
/** 片库观看进度：应用入口接上播放器；追剧日历读某一集的进度 */
export { installLibraryProgress } from './progress/install'
export {
  loadProgress as loadLibraryProgress,
  progressOf as libraryItemProgress,
} from './progress/progress-cache'
/** 首页用：「最近添加」一排、Hero 轮播的片库条目、条目详情路由 */
export { default as RecentlyAddedRow } from './home/RecentlyAddedRow.vue'
export {
  type LibraryHighlight,
  type RecentLibraryItem,
  libraryHighlights,
  libraryItemLocation,
  recentLibraryItems,
} from './home/home-links'
/** 统一搜索：顶部入口和命令面板共用本地召回与 AI 增强。 */
export { UnifiedSearchPanel } from './search/panel'
export { searchLibrary } from './search/search-service'
