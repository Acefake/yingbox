/**
 * 媒体库界面的文字格式化：时长、文件大小、匹配状态、评分。
 */
import type { MatchState } from '../../../../../shared/library/ipc'

/** 匹配状态的中文名。 */
export const MATCH_STATE_LABEL: Record<MatchState, string> = {
  auto: '已匹配',
  locked: '已锁定',
  review: '待确认',
  unmatched: '未匹配',
}

/** 分钟 → “2 小时 9 分钟”。 */
export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (!h) return `${m} 分钟`
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}

/** 字节 → “4.37 GB”。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[i]}`
}

/** 置信度 0–1 → “86%”。 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/** 集编号 “S01E05”。 */
export function episodeCode(
  season: number | null,
  episode: number | null
): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (season === null || episode === null) return ''
  return `S${pad(season)}E${pad(episode)}`
}

/** 路径的文件名部分。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** 路径的目录部分。 */
export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}
