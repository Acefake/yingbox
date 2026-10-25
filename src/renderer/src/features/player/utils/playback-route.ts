/**
 * 播放路由：按用户选的引擎与视频的动态范围决定先试 mpv 还是直接内置播放，以及要不要给杜比视界提示。
 *
 * 杜比视界 Profile 5 这类直接放会偏色的视频（判定只有一份：shared/video-range 的 needsDvColorFix）走一条决策链：
 * 1. 打开时（本文件）：设置「杜比视界 P5 自动用 mpv」开着且有 mpv 桥 → 先试 mpv（ADR-0016）；
 * 2. 进了内置播放器（mpv 没试 / 没起来、播放列表里起始集以外的集、没探测过的本地文件）：
 *    桌面端由 dolby-vision/use-dolby-vision 请主进程 libplacebo 重建（ADR-0017）；
 * 3. 重建做不了：设置开着再试 mpv，否则直接播并在播放区提示颜色可能不正确；
 * 4. 网页端没有重建：直接播，并提示一次建议安装 mpv。
 * P7 / P8、HDR10、HLG 照常内置播放。
 */
import {
  type VideoProbe,
  needsDvColorFix,
} from '../../../../../shared/video-range'

/** playbackRoute 的输入 */
export interface PlaybackRouteInput {
  /** 用户选的引擎（设置或调用方指定） */
  engine: 'built-in' | 'mpv'
  /** 起始文件的动态范围探测结果；没有时按普通视频处理 */
  video?: Pick<VideoProbe, 'dvProfile' | 'dvCompat'> | null
  /** 设置：杜比视界 P5 自动用 mpv */
  autoMpvForDv: boolean
  /** 有 mpv 桥（桌面端 window.api.mpv） */
  mpvBridge: boolean
}

/** 路由结果 */
export interface PlaybackRoute {
  /** 先试 mpv（失败再内置） */
  tryMpv: boolean
  /** 视频是内置播放器放不对颜色的杜比视界 */
  dv: boolean
}

/** 决定先试 mpv 还是内置播放 */
export function playbackRoute(input: PlaybackRouteInput): PlaybackRoute {
  const dv = needsDvColorFix(input.video)
  const wantsMpv = input.engine === 'mpv' || (dv && input.autoMpvForDv)
  return { tryMpv: wantsMpv && input.mpvBridge, dv }
}

/** 杜比视界提示：因 DV 自动用了 mpv / 建议安装 mpv / 不提示 */
export type DvNotice = 'mpv-used' | 'install-mpv' | null

/**
 * 开播后的杜比视界提示。
 * @param route playbackRoute 的结果
 * @param mpv 试 mpv 的结果：成功 / 失败 / 没试
 * @param context 用户选的引擎、「自动用 mpv」设置，以及内置播放器能否重建（桌面端有主进程重建）
 */
export function dvNotice(
  route: PlaybackRoute,
  mpv: 'ok' | 'failed' | 'skipped',
  context: Pick<PlaybackRouteInput, 'engine' | 'autoMpvForDv'> & {
    rebuild: boolean
  }
): DvNotice {
  if (!route.dv) return null
  if (mpv === 'ok') return context.engine === 'built-in' ? 'mpv-used' : null
  // 进内置播放器后由重建接手，做不了时它自己提示，这里不预先建议装 mpv
  if (context.rebuild) return null
  if (mpv === 'failed') return 'install-mpv'
  return context.engine === 'mpv' || context.autoMpvForDv ? 'install-mpv' : null
}

/** 提示文案 */
export const DV_NOTICE_TEXT: Record<Exclude<DvNotice, null>, string> = {
  'mpv-used': '杜比视界 P5 视频已用 mpv 播放：内置播放器放这类视频会偏色',
  'install-mpv': '此视频为杜比视界 P5，内置播放器会偏色，建议安装 mpv',
}
