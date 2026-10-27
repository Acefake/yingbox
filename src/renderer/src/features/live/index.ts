/**
 * 直播（IPTV）feature 的公共出口。页面由路由表直接按需加载 views/LiveView.vue；
 * 这里只导出可供其它模块复用的纯解析规则与类型。
 */
export {
  type LiveChannel,
  type ParsedPlaylist,
  parsePlaylist,
} from './utils/playlist-parse'
/** 首页「正在直播」一排（收藏频道的当前节目） */
export { default as LiveNowRow } from './components/LiveNowRow.vue'
