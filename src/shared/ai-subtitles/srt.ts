/**
 * SRT 解析与生成（纯函数）。AI 字幕写文件用 {@link formatSrt}；
 * 前情提要等功能读 AI 字幕用 {@link parseSrt} + {@link cuesBefore}（只取当前进度之前的台词）。
 */
import type { AiSubtitleCue } from './types'

const TIME = /(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/

/** 「HH:MM:SS,mmm」→ 毫秒；格式不对返回 null */
export function parseSrtTime(text: string): number | null {
  const m = TIME.exec(text.trim())
  if (!m) return null
  const ms = m[4].padEnd(3, '0')
  return (
    Number(m[1]) * 3_600_000 +
    Number(m[2]) * 60_000 +
    Number(m[3]) * 1000 +
    Number(ms)
  )
}

/** 毫秒 → 「HH:MM:SS,mmm」 */
export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(total % 1000, 3)}`
}

/** 解析 SRT 文本（容忍 BOM、CRLF、缺编号、多余空行）；时间行不合法的块跳过 */
export function parseSrt(text: string): AiSubtitleCue[] {
  const cues: AiSubtitleCue[] = []
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter(line => line.trim() !== '')
    const at = lines.findIndex(line => line.includes('-->'))
    if (at < 0) continue
    const [from, to] = lines[at].split('-->')
    const start = parseSrtTime(from)
    const end = parseSrtTime(to ?? '')
    if (start === null || end === null) continue
    const body = lines
      .slice(at + 1)
      .join('\n')
      .trim()
    if (body) cues.push({ start, end: Math.max(start, end), text: body })
  }
  return cues
}

/** 生成 SRT 文本（按开始时间排序、重新编号，跳过空字幕） */
export function formatSrt(cues: readonly AiSubtitleCue[]): string {
  return `${[...cues]
    .filter(cue => cue.text.trim())
    .sort((a, b) => a.start - b.start)
    .map(
      (cue, i) =>
        `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(
          Math.max(cue.start, cue.end)
        )}\n${cue.text.trim()}`
    )
    .join('\n\n')}\n`
}

/** 开始时间早于 seconds 的字幕（不剧透：只给当前进度之前的台词） */
export function cuesBefore(
  cues: readonly AiSubtitleCue[],
  seconds: number
): AiSubtitleCue[] {
  const limit = seconds * 1000
  return cues.filter(cue => cue.start < limit)
}

/** 字幕拼成纯文本（每条一行，双语字幕的多行合成一行） */
export function cuesToText(cues: readonly AiSubtitleCue[]): string {
  return cues.map(cue => cue.text.replace(/\s*\n\s*/g, ' ')).join('\n')
}
