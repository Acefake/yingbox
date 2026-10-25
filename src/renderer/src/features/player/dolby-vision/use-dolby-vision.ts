/**
 * 播放会话里的杜比视界：本地文件开播前决定直接播还是交给主进程 libplacebo 重建成 HLS。
 *
 * - 媒体库已存动态范围的文件（PlaylistEntry.video）直接按 needsDvColorFix 决定，不再探测；不是 P5 的立即直接播；
 * - 不知道的文件才请主进程 ffprobe 识别（与媒体库同一份解析），超过 DV_PROBE_FEEDBACK_MS 才显示「正在识别视频…」；
 * - 重建做不了（开播前）或重建会话播放中出错（recover）：按 dvFallback 试 mpv，否则直接播并提示色彩可能不对；
 * - 每次 prepare / release 换一代：关闭弹窗或换集后才返回的会话立即停掉，不留后台 ffmpeg；
 * - 拿到的本机流前缀登记给桌面 HLS 加载器直连（allowLocalStream），会话结束撤销。
 * 网页端（没有 window.api.dolbyVision）一律直接播。
 */
import { type Ref, onBeforeUnmount } from 'vue'

import { toast } from '@/components/ui'
import { getSetting } from '@/features/settings'
import { toLocalUrl } from '@/utils/local-url'

import { closePlayerModal } from '../modal/player-modal'
import { allowLocalStream } from '../utils/hls-loader'
import {
  DV_DIRECT_WARNING,
  DV_HANDED_OFF_TEXT,
  DV_PREPARING_TEXT,
  DV_PROBE_FEEDBACK_MS,
  DV_PROBING_TEXT,
  DV_RUNTIME_FAILURE,
  DV_SUPERSEDED,
  type DisplayCaps,
  chooseOutput,
  dvFallback,
  localStreamPrefix,
  planFromStart,
} from './dv-rules'
import {
  type VideoProbe,
  needsDvColorFix,
} from '../../../../../shared/video-range'

/** HEVC Main10（Level 5.1）的 MSE 类型串：HDR10 输出用它 */
const HEVC_MAIN10 = 'video/mp4; codecs="hvc1.2.4.L153.B0"'

/** 读显示器与解码能力：matchMedia 的动态范围 + MSE 能否解 HEVC Main10。 */
export function readDisplayCaps(): DisplayCaps {
  const hdrDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(dynamic-range: high)').matches
  const hevcMain10 =
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported(HEVC_MAIN10)
  return { hdrDisplay, hevcMain10 }
}

/** 播放会话交给本模块的界面出口。 */
interface DolbyVisionUi {
  /** 播放地址：显示状态时清空（停掉旧画面） */
  src: Ref<string>
  /** 播放区的状态文字（识别中 / 准备中 / 已转 mpv） */
  emptyText: Ref<string>
  /** 播放区的短暂提示（色彩可能不对） */
  notify: (text: string) => void
}

/** 一个本地文件的开播请求。 */
interface LocalRequest {
  filePath: string
  title: string
  /** 起播位置（秒），重建从这一段开始编码 */
  startAt: number
  /** 媒体库存的动态范围；没有时开播前识别 */
  known?: Pick<VideoProbe, 'dvProfile' | 'dvCompat'> | null
  /** 这次加载是否仍然有效（等待期间换了集返回 false） */
  isCurrent: () => boolean
}

/** useDolbyVision 的返回值。 */
interface DolbyVisionControl {
  /** 本地文件的播放地址；转给 mpv 后返回空串（本会话不再加载） */
  resolve: (request: LocalRequest) => Promise<string>
  /**
   * 播放出错时调用：当前是重建会话就按 dvFallback 退一次。
   * @returns handed-off 已转 mpv；reload 请按同一文件重新加载（这次直接播）；null 不是重建会话，照常处理
   */
  recover: (at: number) => Promise<'handed-off' | 'reload' | null>
  /** 停掉当前重建（换集、关闭播放器时） */
  release: () => void
}

/**
 * 杜比视界播放控制（每个播放会话一份）。
 * @param ui 播放区状态与提示的出口
 */
export function useDolbyVision(ui: DolbyVisionUi): DolbyVisionControl {
  /** 代际：每次 resolve / release 自增，过期的异步结果据此丢弃 */
  let generation = 0
  /** 当前重建会话 id（主进程）与它的文件 */
  let sessionId = ''
  let active: Omit<LocalRequest, 'known' | 'isCurrent'> | null = null
  /** 撤销本机流直连登记 */
  let revokeStream = (): void => {}
  /** 重建失败后这个文件下次直接播（recover 之后的重新加载） */
  let forceDirect = ''

  /** 清掉当前画面、在播放区显示一行状态 */
  const status = (text: string): void => {
    ui.src.value = ''
    ui.emptyText.value = text
  }

  const api = (): Window['api']['dolbyVision'] | undefined =>
    typeof window !== 'undefined' ? window.api?.dolbyVision : undefined

  const release = (): void => {
    generation++
    const id = sessionId
    sessionId = ''
    active = null
    revokeStream()
    revokeStream = () => {}
    if (id)
      void api()
        ?.stop(id)
        .catch(() => {})
  }

  /** 重建做不了：试 mpv（设置允许且有 mpv 桥），否则直接播并提示。 */
  const fallBack = async (
    request: Omit<LocalRequest, 'known' | 'isCurrent'>,
    reason: string
  ): Promise<'handed-off' | 'direct'> => {
    const mpv = typeof window !== 'undefined' ? window.api?.mpv : undefined
    const route = dvFallback({
      autoMpv: getSetting('player.dvAutoMpv'),
      mpvBridge: Boolean(mpv),
    })
    if (route === 'mpv' && mpv) {
      const res = await mpv
        .open({
          filePath: request.filePath,
          title: request.title,
          ...(request.startAt > 0 ? { startAt: request.startAt } : {}),
        })
        .catch(() => null)
      if (res?.success) {
        toast.info(`${reason}，已改用 mpv 播放`)
        status(DV_HANDED_OFF_TEXT)
        closePlayerModal()
        return 'handed-off'
      }
    }
    // 播放区的提示全屏时也看得见
    ui.notify(DV_DIRECT_WARNING)
    return 'direct'
  }

  const resolve = async (request: LocalRequest): Promise<string> => {
    release()
    const gen = generation
    const direct = toLocalUrl(request.filePath)
    const dv = api()
    if (!dv) return direct
    if (forceDirect === request.filePath) {
      forceDirect = ''
      return direct
    }
    forceDirect = ''
    const current = (): boolean => gen === generation && request.isCurrent()
    let known = request.known
    if (!known) {
      const timer = window.setTimeout(() => {
        if (current()) status(DV_PROBING_TEXT)
      }, DV_PROBE_FEEDBACK_MS)
      known = await dv.probe(request.filePath).catch(() => null)
      window.clearTimeout(timer)
    }
    if (!needsDvColorFix(known) || !current()) return direct
    status(DV_PREPARING_TEXT)
    const result = await dv
      .start({
        filePath: request.filePath,
        output: chooseOutput(readDisplayCaps()),
        applyDolbyVision: getSetting('player.applyDolbyVision'),
        startAt: request.startAt,
      })
      .catch((error: unknown) => ({
        kind: 'fallback' as const,
        reason: error instanceof Error ? error.message : String(error),
      }))
    const plan = planFromStart(result)
    if (!current()) {
      if (plan.kind === 'stream') void dv.stop(plan.id).catch(() => {})
      return direct
    }
    if (plan.kind === 'fallback') {
      if (plan.reason === DV_SUPERSEDED) return direct
      return (await fallBack(request, plan.reason)) === 'handed-off'
        ? ''
        : direct
    }
    sessionId = plan.id
    active = {
      filePath: request.filePath,
      title: request.title,
      startAt: request.startAt,
    }
    revokeStream = allowLocalStream(localStreamPrefix(plan.url))
    return plan.url
  }

  const recover = async (
    at: number
  ): Promise<'handed-off' | 'reload' | null> => {
    const failed = active
    if (!sessionId || !failed) return null
    release()
    const outcome = await fallBack(
      { ...failed, startAt: at },
      DV_RUNTIME_FAILURE
    )
    if (outcome === 'handed-off') return 'handed-off'
    forceDirect = failed.filePath
    return 'reload'
  }

  onBeforeUnmount(release)

  return { resolve, recover, release }
}
