/**
 * 「只去码一段」对话框里两个输入框的解析规则（纯函数，便于单测）。
 */

/** 把 "10:30" / "1:02:03" / "630" 解析成秒数；解析不了返回 null */
export function parseClock(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  let seconds = 0
  for (const part of parts) {
    const value = part.trim()
    if (!/^\d+(\.\d+)?$/.test(value)) return null
    seconds = seconds * 60 + Number(value)
  }
  return seconds
}

/**
 * 起点、终点两个输入 → 秒数区间。终点留空表示到片尾（end = 0）。
 * 格式不对时抛出给用户看的错误，确认框会把它显示在框里。
 */
export function readRange(
  startText: string,
  endText: string
): { start: number; end: number } {
  const start = parseClock(startText)
  if (start === null) throw new Error('起点填成 10:00，或者直接填秒数')
  const end = endText.trim() ? parseClock(endText) : 0
  if (end === null) throw new Error('终点填成 20:00，或者直接填秒数')
  if (end > 0 && end <= start) throw new Error('终点要大于起点')
  return { start, end }
}
