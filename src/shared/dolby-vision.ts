/**
 * 杜比视界（Dolby Vision）应用内重建的共享类型：主进程探测 / 重建与渲染层播放共用。
 * 媒体库存的动态范围（卡片小标、P5 交给 mpv 的路由）另见 shared/video-range.ts。
 *
 * 识别来自 ffprobe `-show_streams` 的 DOVI configuration record（side_data_list）：
 * Profile 5（基础层 compat id 0，IPTPQc2 色彩）不重建 RPU 就是偏紫偏绿的画面，
 * 应用内播放要经 libplacebo 重建成 HDR10 / SDR；Profile 7 / 8.x 的基础层本身就是 HDR10 / HLG / SDR，可直接播。
 */

/** 视频流的动态范围类型。 */
export type HdrKind = 'sdr' | 'hdr10' | 'hdr10+' | 'hlg' | 'dolby-vision'

/** 一路视频流的 DOVI configuration record（与 ffprobe 输出的字段一一对应，用驼峰命名）。 */
export interface DoviRecord {
  /** dv_profile，如 5 / 7 / 8 */
  profile: number
  /** dv_level */
  level: number
  /** rpu_present_flag */
  rpu: boolean
  /** el_present_flag（增强层，Profile 7 双层） */
  el: boolean
  /** bl_present_flag（基础层） */
  bl: boolean
  /** dv_bl_signal_compatibility_id：0 = 无兼容（P5），1 = HDR10，2 = SDR，4 = HLG，6 = 蓝光 HDR10 */
  compatId: number
}

/** 一个视频文件的 HDR / 杜比视界识别结果（主进程开播前用 ffprobe 读，重建要用到片长与尺寸）。 */
export interface VideoHdrInfo {
  /** 主视频流的动态范围类型 */
  hdr: HdrKind
  /** 有杜比视界时：配置记录 */
  dovi?: DoviRecord
  /** 杜比视界的人读写法，如「Profile 5」「Profile 8.1」 */
  doviLabel?: string
  /** 基础层没有可直接显示的兼容层（P5），播放前必须重建 RPU */
  needsRpuRebuild: boolean
  /** 基础层本身的动态范围（P8.1 → hdr10，P8.4 → hlg，P5 → 无） */
  baseLayer?: Exclude<HdrKind, 'dolby-vision'>
  width?: number
  height?: number
  /** 时长（秒）；ffprobe 读到才有 */
  duration?: number
}

/** 应用内重建输出：HDR 显示器出 HDR10，否则色调映射到 SDR（bt709）。 */
export type DvOutput = 'hdr10' | 'sdr'

/** 渲染层请求开一路杜比视界播放。 */
export interface DvStartRequest {
  filePath: string
  output: DvOutput
  /** libplacebo apply_dolbyvision（设置可关） */
  applyDolbyVision: boolean
  /** 起播位置（秒）：编码从这一段开始，不必先编片头 */
  startAt?: number
}

/** 开播结果：stream = 交给内置播放器的 HLS 地址；fallback = 本机做不了（reason 为给人看的原因，superseded 表示已被更新的开播取代）。 */
export type DvStartResult =
  | { kind: 'stream'; id: string; url: string }
  | { kind: 'fallback'; reason: string }
