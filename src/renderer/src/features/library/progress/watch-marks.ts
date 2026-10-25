/**
 * 详情页与海报墙上的观看标记（纯规则）：一集 / 一部电影显示「已看」还是「看到 12:30」加进度条，
 * 海报卡显示「已看」角标还是进度条。不依赖 Vue，取数在 progress-cache / use-wall-progress。
 */
import type {
  ProgressSummary,
  WatchProgress,
} from '../../../../../shared/library/ipc'
import { reachedWatched } from '../../../../../shared/library/watch-progress'

/** 播过这么多秒才显示「看到」（误点进来马上关掉的不显示）。 */
export const MARK_MIN_SECONDS = 10

/** 一条观看标记。 */
export interface WatchMark {
  /** 「已看」/「看到 12:30」 */
  label: string
  /** 进度条比例 0–1；0 不显示进度条 */
  ratio: number
  watched: boolean
}

/** 秒 → 「1:02:03」/「12:30」 */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** 一集 / 一部电影的标记；没看过返回 null。正在重看（看完后又从头播）的显示看到哪儿。 */
export function itemMark(p: WatchProgress | null): WatchMark | null {
  if (!p) return null
  const resumable =
    p.position >= MARK_MIN_SECONDS && !reachedWatched(p.position, p.duration)
  const ratio =
    resumable && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0
  if (resumable)
    return { label: `看到 ${clock(p.position)}`, ratio, watched: p.watched }
  return p.watched ? { label: '已看', ratio: 0, watched: true } : null
}

/** 海报卡的标记：看完显示「已看」角标；看了一部分显示进度条；没看过返回 null。 */
export function posterMark(s: ProgressSummary | undefined): WatchMark | null {
  if (!s) return null
  if (s.watched) return { label: '已看', ratio: 0, watched: true }
  return s.ratio > 0 ? { label: '', ratio: s.ratio, watched: false } : null
}

/** 进度条宽度（style 用）。 */
export const ratioWidth = (ratio: number): string =>
  `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%`
