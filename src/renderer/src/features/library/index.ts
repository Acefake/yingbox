/**
 * 本地媒体库 feature 的公共出口（页面本身由 router 按需加载，不经这里）。
 */
export {
  type LibraryActivity,
  useIdentifyActivity,
  useLibraries,
} from './state/use-libraries'
export { useActiveJobs } from './state/use-active-jobs'
/** 追剧日历用：剧按分类直接打开对应页面的详情 */
export { seriesPagePath } from './state/library-section'
/** 侧栏用：本地媒体里有条目的页面（都没有时是「添加媒体库」入口） */
export { useLocalNavPages } from './state/use-local-nav-pages'
/** 追剧日历用：播出数据、播放某一集、图片地址、文件进度键 */
export {
  fetchCalendarEpisodes,
  fetchItemPoster,
  libraryImage,
  libraryProgressKey,
  playLibraryEpisode,
} from './detail/calendar-links'
/** AI 助手技能包用：按来源查条目、随机一条、播放条目、取视频文件 */
export {
  type LibraryLookup,
  findLibraryItems,
  libraryItemVideo,
  libraryPoster,
  playLibraryItem,
  randomLibraryItem,
} from './detail/assistant-links'
/** AI 助手结果卡用：片库条目的说明行、规格标签、评分、想看登记与详情路由 */
export { type LibraryCardInfo, libraryCardInfo } from './detail/card-info'
/** 片库观看进度：应用入口接上播放器；追剧日历读某一集的进度 */
export { installLibraryProgress } from './progress/install'
export { resumeLibrary } from './progress/resume-library'
export { librarySettingsSection } from './settings/section'
export {
  loadProgress as loadLibraryProgress,
  progressOf as libraryItemProgress,
} from './progress/progress-cache'
/** 首页用：「刚入库」一排、Hero 轮播的片库条目（含某一部）、条目详情路由 */
export { default as RecentlyAddedRow } from './home/RecentlyAddedRow.vue'
export {
  type LibraryHighlight,
  type RecentLibraryItem,
  libraryHighlight,
  libraryHighlights,
  libraryItemLocation,
  recentLibraryItems,
} from './home/home-links'
/** 统一入口（搜索与 AI 助手共用的居中浮层）里的片库搜索：召回、结果列表、CLIP 范围（按需加载） */
export const loadLibrarySearch = (): Promise<
  typeof import('./search/entry-search')
> => import('./search/entry-search')
export type LibrarySearchModule = typeof import('./search/entry-search')
export type { LibrarySearch, SearchEntry } from './search/entry-search'
export { searchLibrary } from './search/search-service'
export { fuseSearch, routeSearch } from './search/search-rules'
export { libraryBridge as searchLibraryBridge } from './api/bridge'
export type { RecallBatch, SearchHit } from './search/types'

export { enhanceConditions, enhanceReady } from './search/ai-conditions'
export { looksNatural } from './nl-search/nl-rules'
