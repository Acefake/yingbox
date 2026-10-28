import { toast } from '@/components/ui'
import { getSetting } from '@/features/settings'

import type { VideoProbe } from '../../../../../shared/video-range'
import { syncHighQualityScaling } from '../scaling/scaling-sync'
import type { ContinueMeta } from '../continue/continue-rules'
import { startContinue } from '../continue/continue-store'
import { trackMpvSession } from '../mpv-session/mpv-session'
import { watchMpvInstall } from '../utils/mpv-handoff'
import type { LibraryRef } from '../progress/library-sink'
import type { EndHint } from '../utils/play-queue'
import { openPlayer } from '../host/player-host'
import {
  DV_NOTICE_TEXT,
  dvNotice,
  playbackRoute,
} from '../utils/playback-route'

/** 播放列表条目：用于自动连播与失败换源 */
export type PlayerSourceItem = {
  url?: string
  filePath?: string
  /** 展示名（集名 / 文件名） */
  name?: string
  /** CatSpider 插件参数 */
  ext?: Record<string, unknown>
  /** CatSpider 站点名 */
  siteName?: string
  /** 本地文件的动态范围（媒体库存的探测结果）：杜比视界 P5 进内置播放器时据此直接决定是否重建 */
  video?: VideoProbe | null
  /** 媒体库条目（条目 id + 文件 id）：进度只记进片库 */
  library?: LibraryRef
}

type MediaPlayerOpenOptions = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  /** Resume position in seconds */
  startAt?: number
  /** 自动连播队列（当前线路的剧集） */
  playlist?: PlayerSourceItem[]
  /** 起始项下标 */
  index?: number
  /** 同集备用线路：播放失败时优先尝试 */
  fallbacks?: PlayerSourceItem[]
  /**
   * 记进「继续播放」：哪个板块、哪一条、打开详情用的数据。不给就不记（如临时预览、lada 任务）。
   * 应用内播放器与 mpv（mpv-session 跟着 mpv 的状态）都会持续更新进度、看完换下一集。
   */
  continueAs?: ContinueMeta
  /**
   * 来自私密板块（AV / 番号 / lada 等）：AI 字幕的翻译与云端转写只发给本地模型（按设置）。
   * 不给时按 continueAs 的板块判断（av、jav 为私密）。
   */
  private?: boolean
  /** 播放引擎：'built-in' 为内置播放器（桌面端独立窗口），'mpv' 为 mpv 独立播放器，不传则读取全局设置 */
  engine?: 'built-in' | 'mpv'
  /** 起始文件的动态范围（媒体库扫描时 ffprobe 探测）：杜比视界 P5 据此改走 mpv，见 utils/playback-route */
  video?: VideoProbe | null
  /** 播完最后一集时的提示（如媒体库剧集「没有下一集的文件」+ 去追更） */
  endHint?: EndHint
}

/**
 * 把 RTX 视频超分开关同步给主进程。
 * 主进程据此决定 mpv 启动参数（d3d11 GPU API / 硬解）与运行时滤镜挂载。
 */
export function syncRtxVsr(): void {
  const api = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!api?.setVsr) return
  void api.setVsr(getSetting('player.rtxVsr')).catch(() => {
    /* 非 Electron 或旧版本预加载：静默忽略 */
  })
}

/** 私密板块：开播时自动标记 private */
const PRIVATE_SECTIONS: ReadonlySet<string> = new Set(['av', 'jav'])

/** 每个会话只提示一次 mpv 回退，避免每次播放都弹 */
let mpvFallbackNotified = false
/** 每个会话只提示一次「杜比视界 P5 建议安装 mpv」 */
let dvInstallNotified = false

/**
 * mpv 不可用时（最常见的是系统未安装 mpv）给出一次可见提示。
 * 详细原因（含安装指引）写入控制台，提示本身保持简短。
 */
function notifyMpvFallback(detail?: string): void {
  if (detail)
    console.warn('[openMediaPlayer] mpv 不可用，已改用内置播放器:', detail)
  if (mpvFallbackNotified) return
  mpvFallbackNotified = true
  // 自动下载失败时说清原因（网络 / 解压），否则是非 Windows 没装 mpv
  toast.warning(
    detail?.includes('自动下载也失败')
      ? `${detail}本次已改用内置播放器。`
      : '未检测到 mpv 播放器，已改用内置播放器。可在「设置 → 播放器」查看安装方法。'
  )
}

/**
 * 打开播放器：
 * - 引擎为 mpv，或视频是杜比视界 P5 且开着自动用 mpv：启动 / 控制 mpv 独立播放器（不可用时提示并回退到内置）
 * - 否则：内置播放器——桌面端在独立的播放器窗口里播，网页端是盖在页面上的播放层（host/player-host）
 */
export async function openMediaPlayer(
  options: MediaPlayerOpenOptions
): Promise<boolean> {
  const filePath =
    typeof options.filePath === 'string' ? options.filePath.trim() : ''
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  const title = typeof options.title === 'string' ? options.title : undefined
  const poster = typeof options.poster === 'string' ? options.poster.trim() : ''
  const startAt =
    typeof options.startAt === 'number' && Number.isFinite(options.startAt)
      ? Math.max(0, options.startAt)
      : undefined
  const playlist =
    Array.isArray(options.playlist) && options.playlist.length
      ? options.playlist
      : undefined
  const fallbacks =
    Array.isArray(options.fallbacks) && options.fallbacks.length
      ? options.fallbacks
      : undefined
  const index =
    Number.isInteger(options.index) && (options.index as number) >= 0
      ? (options.index as number)
      : undefined

  if (!filePath && !url && !playlist) return false
  const isPrivate =
    options.private ?? PRIVATE_SECTIONS.has(options.continueAs?.section ?? '')

  const continueId = options.continueAs
    ? startContinue(
        options.continueAs,
        {
          ...(url ? { url } : {}),
          ...(filePath ? { filePath } : {}),
          ...(playlist ? { playlist } : {}),
          ...(typeof index === 'number' ? { index } : {}),
          ...(fallbacks ? { fallbacks } : {}),
        },
        startAt ?? 0
      )
    : ''

  const engine = options.engine || getSetting('player.engine')
  const autoMpvForDv = getSetting('player.dvAutoMpv')
  const route = playbackRoute({
    engine,
    video: playlist?.[index ?? 0]?.video ?? options.video,
    autoMpvForDv,
    mpvBridge: typeof window !== 'undefined' && Boolean(window.api?.mpv),
  })
  let mpv: 'ok' | 'failed' | 'skipped' = 'skipped'
  let mpvError: string | undefined
  if (route.tryMpv && window.api?.mpv) {
    // 找不到 mpv 时主进程会先自动下载（Windows），这里显示下载中的提示
    watchMpvInstall()
    try {
      // 先同步超分开关，保证首次启动 mpv 时启动参数正确
      syncRtxVsr()
      await syncHighQualityScaling()
      const res = await window.api.mpv.open({
        ...(filePath ? { filePath } : {}),
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        ...(typeof startAt === 'number' ? { startAt } : {}),
        ...(playlist
          ? {
              playlist: playlist.map(item => ({
                filePath: item.filePath,
                url: item.url,
                name: item.name,
              })),
            }
          : {}),
        ...(typeof index === 'number' ? { index } : {}),
      })
      // 主进程以失败结果返回（例如未安装 mpv）：提示并回退
      mpv = res?.success ? 'ok' : 'failed'
      mpvError = res?.error
    } catch (e) {
      mpv = 'failed'
      mpvError = e instanceof Error ? e.message : String(e)
    }
  }

  const notice = dvNotice(route, mpv, {
    engine,
    autoMpvForDv,
    rebuild: typeof window !== 'undefined' && Boolean(window.api?.dolbyVision),
  })
  if (notice === 'mpv-used') toast.info(DV_NOTICE_TEXT['mpv-used'])
  // mpv 播放：跟着它的状态记进度、连播；改用内置播放器时不再跟
  trackMpvSession(
    mpv === 'ok'
      ? {
          continueId,
          playlist: playlist ?? [
            { ...(filePath ? { filePath } : {}), ...(url ? { url } : {}) },
          ],
          index: index ?? 0,
          title: title ?? '',
          endHint: options.endHint,
        }
      : null
  )
  if (mpv === 'ok') return true
  if (notice === 'install-mpv') {
    if (!dvInstallNotified) toast.warning(DV_NOTICE_TEXT['install-mpv'])
    dvInstallNotified = true
  } else if (mpv === 'failed') notifyMpvFallback(mpvError)

  openPlayer({
    ...(filePath ? { filePath } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(poster ? { poster } : {}),
    ...(typeof startAt === 'number' ? { startAt } : {}),
    ...(playlist ? { playlist } : {}),
    ...(typeof index === 'number' ? { index } : {}),
    ...(fallbacks ? { fallbacks } : {}),
    ...(continueId ? { continueId } : {}),
    ...(options.endHint ? { endHint: options.endHint } : {}),
    ...(isPrivate ? { private: true } : {}),
    ...(filePath && !playlist && options.video ? { video: options.video } : {}),
  })
  return true
}
