/**
 * 虚拟网格的几何计算（纯函数）：列数、格子尺寸、某一滚动位置下应渲染哪些行。
 *
 * 海报墙只渲染视口内（加上下各几行缓冲）的格子，5 万条也只有几十个 DOM 节点。
 * 行高固定（海报 2:3 + 文字区），所以任意下标的位置都能直接算出，不需要测量。
 */

/** 网格参数（来自设计令牌）。 */
export interface GridOptions {
  /** 格子最小宽度。 */
  minCellWidth: number
  gapX: number
  gapY: number
  /** 海报下方文字区高度。 */
  textHeight: number
  /** 海报高宽比（2:3 海报为 1.5）。 */
  aspect: number
}

/** 某个容器宽度下的网格尺寸。 */
export interface GridMetrics {
  columns: number
  cellWidth: number
  /** 海报图高度。 */
  mediaHeight: number
  /** 一行的步长（格子高度 + 行距）。 */
  rowStride: number
  gapX: number
}

/** 应渲染的区间：[start, end) 是条目下标，行号同理。 */
export interface GridRange {
  startRow: number
  endRow: number
  start: number
  end: number
}

/** 按容器宽度算出列数与格子尺寸；宽度不足一格时仍按 1 列。 */
export function gridMetrics(width: number, options: GridOptions): GridMetrics {
  const { minCellWidth, gapX, gapY, textHeight, aspect } = options
  const columns = Math.max(
    1,
    Math.floor((width + gapX) / (minCellWidth + gapX))
  )
  const cellWidth = Math.max(0, (width - gapX * (columns - 1)) / columns)
  const mediaHeight = Math.round(cellWidth * aspect)
  return {
    columns,
    cellWidth,
    mediaHeight,
    rowStride: mediaHeight + textHeight + gapY,
    gapX,
  }
}

/** 总行数。 */
export function rowCount(metrics: GridMetrics, count: number): number {
  return Math.ceil(count / metrics.columns)
}

/** 网格内容总高度（最后一行不加行距）。 */
export function contentHeight(
  metrics: GridMetrics,
  count: number,
  gapY: number
): number {
  const rows = rowCount(metrics, count)
  return rows === 0 ? 0 : rows * metrics.rowStride - gapY
}

/**
 * 滚动位置 → 应渲染的行区间。overscan 是视口上下各多渲染的行数，
 * 快速滚动时不露白；scrollTop 为网格顶部相对视口顶部的距离（可为负：网格上方还有页眉）。
 */
export function visibleRange(
  metrics: GridMetrics,
  count: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): GridRange {
  const rows = rowCount(metrics, count)
  if (rows === 0 || metrics.rowStride <= 0) {
    return { startRow: 0, endRow: 0, start: 0, end: 0 }
  }
  const first = Math.floor(Math.max(0, scrollTop) / metrics.rowStride)
  const last = Math.ceil(
    Math.max(0, scrollTop + viewportHeight) / metrics.rowStride
  )
  const startRow = Math.min(rows, Math.max(0, first - overscan))
  const endRow = Math.min(rows, Math.max(startRow, last + overscan))
  return {
    startRow,
    endRow,
    start: Math.min(count, startRow * metrics.columns),
    end: Math.min(count, endRow * metrics.columns),
  }
}

/** 下标 → 格子左上角坐标。 */
export function cellOffset(
  metrics: GridMetrics,
  index: number
): { x: number; y: number } {
  const row = Math.floor(index / metrics.columns)
  const column = index % metrics.columns
  return {
    x: Math.round(column * (metrics.cellWidth + metrics.gapX)),
    y: row * metrics.rowStride,
  }
}

/** 两个区间是否相同（相同就不触发重新渲染）。 */
export function sameRange(a: GridRange, b: GridRange): boolean {
  return a.start === b.start && a.end === b.end && a.startRow === b.startRow
}
