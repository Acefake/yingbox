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
