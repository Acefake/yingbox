/**
 * 进度条悬停气泡的内容：指针位置换算成时间点，落在片头 / 片尾区间时带上段名（YouTube 的章节名）。
 */
import {
  type SkipMarks,
  formatClock,
  validIntro,
  validOutro,
} from './skip-rules'

/** 悬停气泡 */
export interface HoverInfo {
  /** 秒 */
  time: number
  /** 段名：片头 / 片尾；不在区间里为空串 */
  label: string
  /** 气泡文字：「1:23」或「1:23 · 片头」 */
  text: string
}

/**
 * @param percentage 指针在进度条上的位置（0–1，越界夹回）
 * @param duration 视频时长（秒）；未知时返回 null
 * @param marks 本剧的片头片尾标记
 */
export function hoverInfo(
  percentage: number,
  duration: number,
  marks: SkipMarks
): HoverInfo | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  const p = Math.min(
    1,
    Math.max(0, Number.isFinite(percentage) ? percentage : 0)
  )
  const time = p * duration
  let label = ''
  if (
    validIntro(marks.intro) &&
    time >= marks.intro.start &&
    time < marks.intro.end
  )
    label = '片头'
  else if (validOutro(marks.outro) && time >= duration - marks.outro)
    label = '片尾'
  const clock = formatClock(time)
  return { time, label, text: label ? `${clock} · ${label}` : clock }
}
