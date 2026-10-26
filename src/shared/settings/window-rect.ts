/**
 * 设置里的窗口矩形（播放器窗口关窗时记下的位置与大小，见 src/main/player-window）。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

/** 窗口位置与大小（屏幕坐标，整数像素） */
export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

/** 解析窗口矩形：四个安全整数、宽高为正；null 表示未记录；不合法返回 undefined */
export function parseWindowRect(raw: unknown): WindowRect | null | undefined {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<Record<keyof WindowRect, unknown>>
  const values = [r.x, r.y, r.width, r.height]
  if (!values.every(v => Number.isSafeInteger(v))) return undefined
  const [x, y, width, height] = values as number[]
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}
