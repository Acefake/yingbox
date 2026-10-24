/** 「已看完」集合：看完一集时由播放器记录，供防剧透等读取。 */
export {
  isWatched,
  markWatched,
  readWatched,
  unmarkWatched,
  WATCHED_STORAGE_KEY,
} from './watched-store'
export type { WatchedEntry } from './watched-rules'
