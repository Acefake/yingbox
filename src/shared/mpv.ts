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

/** 超分请求与配置状态，不代表驱动侧 AI 效果已验证。 */
export interface MpvVsrStatus {
  state:
    | 'off'
    | 'waiting'
    | 'unsupported'
    | 'bypassed'
    | 'configured'
    | 'failed'
  reason: string
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
  /** 处于「缩小置顶」（右下角小窗、保持在最前） */
  compact?: boolean
  /** 请求与滤镜配置状态；不能据此证明 AI 效果已启用。 */
  vsr?: MpvVsrStatus
  /** 当前片源分辨率（解码后的实际尺寸） */
  videoWidth?: number
  videoHeight?: number
  /** mpv 实际报告的整条视频滤镜链输出尺寸，不代表原生片源或单个滤镜的贡献。 */
  filteredVideoWidth?: number
  filteredVideoHeight?: number
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
