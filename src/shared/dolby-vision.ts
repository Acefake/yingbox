/**
 * 杜比视界（Dolby Vision）应用内重建的共享类型：主进程重建与渲染层播放共用。
 * 动态范围的识别与「要不要处理」的判定只有一份，在 shared/video-range.ts（ADR-0016）。
 *
 * Profile 5（基础层 compat id 0，IPTPQc2 色彩）不按 RPU 重建就是偏紫偏绿的画面，
 * 应用内播放要经 libplacebo 重建成 HDR10 / SDR；Profile 7 / 8.x 的基础层本身就是 HDR10 / HLG / SDR，可直接播。
 */

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
