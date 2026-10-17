/** mpv 轨道信息（视频 / 音频 / 字幕） */
export interface MpvTrack {
  id: number
  type: 'audio' | 'video' | 'sub'
  title?: string
  lang?: string
  selected: boolean
  codec?: string
  forced?: boolean
  default?: boolean
  /** 外挂字幕文件名 */
  externalFilename?: string
}

/** 播放列表条目 */
export interface MpvPlaylistEntry {
  filePath?: string
  url?: string
  name?: string
}

/** 播放器实时状态（由主进程推送到渲染层） */
export interface MpvStatus {
  running: boolean
  /** 正在启动播放器或加载媒体，播放就绪后清除 */
  loading?: boolean
  title?: string
  path?: string
  duration?: number
  position?: number
  paused: boolean
  volume: number
  muted: boolean
  speed: number
  tracks: MpvTrack[]
  playlist: MpvPlaylistEntry[]
  playlistPos: number
  /** RTX 视频超分滤镜当前是否已挂载（仅 Windows + NVIDIA 且片源低于 1080p 时为 true） */
  vsr?: boolean
  /** 当前片源分辨率（解码后的实际尺寸） */
  videoWidth?: number
  videoHeight?: number
  /** 超分后的分辨率（VSR 未启用时为空） */
  vsrWidth?: number
  vsrHeight?: number
}

/** 打开播放的选项 */
export interface MpvOpenOptions {
  filePath?: string
  url?: string
  title?: string
  /** 从指定秒数开始播放 */
  startAt?: number
  /** 播放列表（批量入队） */
  playlist?: MpvPlaylistEntry[]
  /** 播放列表起始下标 */
  index?: number
  /** 外挂字幕文件路径 */
  subFile?: string
}
