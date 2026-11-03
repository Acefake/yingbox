/** 播放列表条目的形状：渲染层播放器、继续观看记录与服务端播放记录共用。 */
import type { VideoProbe } from '../video-range'

/** 播放条目上的媒体库标记（随继续播放记录持久化，须可 JSON 序列化）。 */
export interface LibraryRef {
  /** 电影或那一集的条目 id */
  itemId: number
  /** 播放的视频文件 id */
  fileId: number
}

/** 单个播放条目（集 / 文件 / 备用线路） */
export type PlaylistEntry = {
  url?: string
  filePath?: string
  name?: string
  ext?: Record<string, unknown>
  siteName?: string
  /** 本地文件的动态范围（媒体库存的探测结果）；有它时杜比视界判断不必开播前再探测 */
  video?: VideoProbe | null
  /** 媒体库条目：进度只记进片库（见 progress/library-sink） */
  library?: LibraryRef
  /** 片库记的续播位置（秒，看完的为 0）：主窗口把播放交给播放器窗口时填上，那边没有片库缓存 */
  libraryResume?: number
}
