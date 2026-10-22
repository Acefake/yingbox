/**
 * 虚拟列表 / 网格的纯计算（UiVirtualGrid 用）。不碰 DOM，便于测试。
 *
 * 模型：items 按行排，每行 columns 个；所有行等高，相邻两行起点相距 stride 像素
 * （行高 + 行间距）。只渲染视口附近的行，上下用 padding 撑出被跳过的行的高度，
 * 这样滚动条长度、外层「滚到底加载更多」的判断都和全部渲染时一致。
 */

/** 还没量到行距时先渲染的条数（够铺满一屏，用来量行距和列数） */
export const INITIAL_RENDER = 48

export interface RangeInput {
  /** 总条数 */
  count: number
  /** 每行几列（≥ 1） */
  columns: number
  /** 相邻两行起点的距离（px）；≤ 0 表示还没量到 */
  stride: number
  /** 视口上沿相对列表内容起点的偏移（px），列表在视口下方时为负 */
  viewTop: number
  /** 视口高度（px） */
  viewHeight: number
  /** 视口上下各多渲染几行，滚动时不露白 */
  overscan?: number
}

export interface VisibleRange {
  /** 渲染 items[start, end) */
  start: number
  end: number
  /** 上方被跳过的行占的高度（px） */
  padTop: number
  /** 下方被跳过的行占的高度（px） */
  padBottom: number
}

/** 根据视口位置算出要渲染的条目区间和上下占位高度 */
export function visibleRange(input: RangeInput): VisibleRange {
  const { count, stride, viewTop, viewHeight, overscan = 2 } = input
  const columns = Math.max(1, Math.floor(input.columns) || 1)
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  if (!(stride > 0)) {
    return {
      start: 0,
      end: Math.min(count, INITIAL_RENDER),
      padTop: 0,
      padBottom: 0,
    }
  }
  const rows = Math.ceil(count / columns)
  const clampRow = (row: number): number => Math.min(rows, Math.max(0, row))
  const firstRow = clampRow(Math.floor(viewTop / stride) - overscan)
  const lastRow = Math.max(
    firstRow,
    clampRow(Math.ceil((viewTop + viewHeight) / stride) + overscan)
  )
  return {
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    padTop: firstRow * stride,
    padBottom: (rows - lastRow) * stride,
  }
}

/**
 * 从 getComputedStyle(el).gridTemplateColumns 数出列数。
 * 浏览器返回的是解析后的轨道列表（如 "260px 260px 260px"）；非 grid 元素是 "none"，按 1 列算。
 */
export function countColumns(template: string): number {
  const value = template.trim()
  if (!value || value === 'none') return 1
  // 去掉命名网格线 [a b]，剩下的每一段是一条轨道
  const tracks = value
    .replace(/\[[^\]]*\]/g, ' ')
    .trim()
    .split(/\s+/)
  return Math.max(1, tracks.filter(Boolean).length)
}

/**
 * 由已渲染的行量出行距：lastRowTop 是已渲染的最后一个整行（第 rowsApart 行）的顶部，
 * 取平均行距（含行间距和外边距），个别行略高时误差被摊平；
 * 只有一行时取首个元素高度加 CSS row-gap。量不到返回 0。
 */
export function measureStride(
  firstTop: number,
  firstHeight: number,
  lastRowTop: number | null,
  rowsApart: number,
  rowGap: number
): number {
  if (lastRowTop !== null && rowsApart >= 1 && lastRowTop > firstTop)
    return (lastRowTop - firstTop) / rowsApart
  if (firstHeight > 0)
    return firstHeight + (Number.isFinite(rowGap) ? rowGap : 0)
  return 0
}

/**
 * 是否渲染到了最后一条（UiVirtualGrid 据此发 reach-end，外层加载下一页）。
 * 视口下方还有 overscan 行余量，所以离底还差一两行时就会触发；没量到行距（首帧先渲染一批）不算。
 */
export function isAtEnd(
  range: VisibleRange,
  count: number,
  stride: number
): boolean {
  return count > 0 && stride > 0 && range.end >= count
}
