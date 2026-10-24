/**
 * 「想看」清单 feature 的公共出口：详情页的想看按钮、板块顶部的想看横排、清单存取。
 * 应用入口调用 installWatchlist，整部看完的条目自动移出清单。
 */
export { default as WatchlistButton } from './WatchlistButton.vue'
export { default as WatchlistRow } from './WatchlistRow.vue'
export {
  installWatchlist,
  inWatchlist,
  removeFromWatchlist,
  toggleWatchlist,
  watchlistEntries,
} from './watchlist-store'
export type {
  WatchlistEntry,
  WatchlistMeta,
  WatchlistSection,
} from './watchlist-rules'
