/**
 * 独立服务给片库核心补的宿主能力（与桌面端 engine/entry.ts 注入的同名项对应）：
 *
 * | 能力                         | 桌面端                         | 独立服务（这里）                                   |
 * | ---------------------------- | ------------------------------ | -------------------------------------------------- |
 * | 视频动态范围探测 probeVideo  | ffprobe 路径向主进程要         | `YINGBOX_FFPROBE` 或 PATH 上的 ffprobe             |
 * | 按画面搜抽帧 ffmpegPath      | ffmpeg 路径向主进程要          | `YINGBOX_FFMPEG` 或 PATH 上的 ffmpeg               |
 * | 自动中文字幕 intake          | 主进程设置 subtitles.auto.*    | `YINGBOX_AUTO_SUBTITLES` / `YINGBOX_SUBTITLES_DAILY_LIMIT` |
 * | 内封字幕流探测 probeStreams  | 同上 ffprobe                   | 同上 ffprobe                                       |
 *
 * 找不到 ffprobe / ffmpeg 时探测结果是 'unavailable'（整轮停下，装上后下次扫描再补），不影响扫描与刮削。
 * 自动字幕只在显式打开时启动（入库宣布的水位从打开那一刻算起，之前已在库里的不补）。
 */
import type { LibraryPlatform } from '../main/library/platform/platform'
import { createVideoProber } from '../main/library/scanner/video-probe'
import type { AutoSubtitleSettings } from '../main/library/subtitles/auto-subtitles'
import { createStreamProber } from '../main/library/subtitles/stream-probe'

/** 每日下载上限的取值范围与默认值（与桌面端设置 subtitles.auto.dailyLimit 相同）。 */
export const SUBTITLE_DAILY_LIMIT = { min: 1, max: 100, fallback: 5 } as const

const TRUE_WORDS = new Set(['1', 'true', 'on', 'yes'])

/** 环境变量 → 自动字幕设置；没打开返回 null。 */
export function autoSubtitleSettings(
  env: NodeJS.ProcessEnv
): AutoSubtitleSettings | null {
  const flag = env.YINGBOX_AUTO_SUBTITLES?.trim().toLowerCase() ?? ''
  if (!TRUE_WORDS.has(flag)) return null
  const raw = Number(env.YINGBOX_SUBTITLES_DAILY_LIMIT)
  const { min, max, fallback } = SUBTITLE_DAILY_LIMIT
  const dailyLimit = Number.isInteger(raw)
    ? Math.min(max, Math.max(min, raw))
    : fallback
  return { enabled: true, dailyLimit }
}

/** ffprobe / ffmpeg 的路径：环境变量优先，没设时交给 PATH。 */
export function toolPaths(env: NodeJS.ProcessEnv): {
  ffprobe: string
  ffmpeg: string
} {
  return {
    ffprobe: env.YINGBOX_FFPROBE?.trim() || 'ffprobe',
    ffmpeg: env.YINGBOX_FFMPEG?.trim() || 'ffmpeg',
  }
}

/** 独立服务的宿主能力（合进 createLibraryService 的 platform 参数）。 */
export function serverLibraryHost(
  env: NodeJS.ProcessEnv
): Pick<LibraryPlatform, 'probeVideo' | 'ffmpegPath' | 'intake'> {
  const tools = toolPaths(env)
  const subtitles = autoSubtitleSettings(env)
  return {
    probeVideo: createVideoProber({ binary: () => tools.ffprobe }),
    ffmpegPath: async () => tools.ffmpeg,
    intake: subtitles
      ? {
          subtitleSettings: async () => subtitles,
          probeStreams: createStreamProber({ binary: () => tools.ffprobe }),
        }
      : undefined,
  }
}
