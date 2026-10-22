/**
 * 小窗拖动松手后吸附到哪个角：看小窗中心点落在视口的哪个象限。
 */

/** 小窗停靠的角 */
export type MiniCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/**
 * 离中心点最近的角。
 * @param center 小窗中心点（视口坐标）
 * @param view 视口尺寸
 */
export function nearestCorner(
  center: { x: number; y: number },
  view: { width: number; height: number }
): MiniCorner {
  const vertical = center.y < view.height / 2 ? 'top' : 'bottom'
  const horizontal = center.x < view.width / 2 ? 'left' : 'right'
  return `${vertical}-${horizontal}`
}
