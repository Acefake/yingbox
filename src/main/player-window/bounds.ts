/**
 * 播放器窗口的位置与大小（纯函数）：首次打开按主屏居中，之后用关窗时记下的；
 * 记下的位置已不在任何屏幕上（拔了副屏、改了分辨率）时回到主屏，尺寸夹进所在屏幕的工作区。
 */
import type { WindowRect } from '../../shared/settings/window-rect'

/** 最小尺寸（16:9） */
export const PLAYER_WINDOW_MIN = { width: 480, height: 270 } as const

/** 首次打开占主屏工作区宽度的比例 */
const DEFAULT_RATIO = 0.7

/** 记下的窗口至少要有这么大比例落在某个屏幕上才沿用 */
const VISIBLE_RATIO = 0.25

const area = (r: WindowRect): number => r.width * r.height

/** 两个矩形相交部分的面积 */
function overlap(a: WindowRect, b: WindowRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** 主屏工作区里居中的 16:9 窗口 */
export function defaultBounds(work: WindowRect): WindowRect {
  let width = Math.round(work.width * DEFAULT_RATIO)
  let height = Math.round((width * 9) / 16)
  if (height > work.height * DEFAULT_RATIO) {
    height = Math.round(work.height * DEFAULT_RATIO)
    width = Math.round((height * 16) / 9)
  }
  width = Math.max(PLAYER_WINDOW_MIN.width, Math.min(width, work.width))
  height = Math.max(PLAYER_WINDOW_MIN.height, Math.min(height, work.height))
  return {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + Math.round((work.height - height) / 2),
    width,
    height,
  }
}

/** 把窗口夹进一块工作区：先缩到放得下，再挪进来 */
function clampInto(rect: WindowRect, work: WindowRect): WindowRect {
  const width = Math.max(
    PLAYER_WINDOW_MIN.width,
    Math.min(rect.width, work.width)
  )
  const height = Math.max(
    PLAYER_WINDOW_MIN.height,
    Math.min(rect.height, work.height)
  )
  return {
    x: Math.min(Math.max(rect.x, work.x), work.x + work.width - width),
    y: Math.min(Math.max(rect.y, work.y), work.y + work.height - height),
    width,
    height,
  }
}

/**
 * 这次打开用的位置与大小。
 * @param saved 关窗时记下的（没有为 null）
 * @param works 各屏幕的工作区
 * @param primary 主屏工作区
 */
export function restoreBounds(
  saved: WindowRect | null,
  works: readonly WindowRect[],
  primary: WindowRect
): WindowRect {
  if (!saved) return defaultBounds(primary)
  let best: WindowRect | null = null
  let bestArea = 0
  for (const work of works) {
    const shared = overlap(saved, work)
    if (shared > bestArea) {
      best = work
      bestArea = shared
    }
  }
  if (!best || bestArea < area(saved) * VISIBLE_RATIO)
    return defaultBounds(primary)
  return clampInto(saved, best)
}
