import { describe, expect, it } from 'vitest'

import {
  cellOffset,
  contentHeight,
  gridMetrics,
  rowCount,
  sameRange,
  visibleRange,
} from '../../../src/renderer/src/features/library/wall/virtual-grid'

const OPTIONS = {
  minCellWidth: 160,
  gapX: 24,
  gapY: 32,
  textHeight: 52,
  aspect: 1.5,
}

describe('gridMetrics', () => {
  it('按最小格宽放尽量多的列，剩余宽度平均分给每格', () => {
    // (1200 + 24) / (160 + 24) = 6.65 → 6 列
    const m = gridMetrics(1200, OPTIONS)
    expect(m.columns).toBe(6)
    expect(m.cellWidth).toBeCloseTo((1200 - 24 * 5) / 6)
    expect(m.mediaHeight).toBe(Math.round(m.cellWidth * 1.5))
    expect(m.rowStride).toBe(m.mediaHeight + 52 + 32)
  })

  it('容器比一格还窄时仍是 1 列', () => {
    expect(gridMetrics(100, OPTIONS).columns).toBe(1)
    expect(gridMetrics(0, OPTIONS).columns).toBe(1)
  })
})

describe('visibleRange', () => {
  const m = gridMetrics(1200, OPTIONS)

  it('顶部：只渲染视口内的行加下方缓冲', () => {
    const r = visibleRange(m, 50_000, 0, 800, 2)
    const visibleRows = Math.ceil(800 / m.rowStride)
    expect(r.startRow).toBe(0)
    expect(r.endRow).toBe(visibleRows + 2)
    expect(r.start).toBe(0)
    expect(r.end).toBe((visibleRows + 2) * m.columns)
  })

  it('5 万条滚到中间，渲染的格子数与总数无关', () => {
    const top = 4000 * m.rowStride + 10
    const r = visibleRange(m, 50_000, top, 800, 2)
    expect(r.startRow).toBe(4000 - 2)
    expect(r.end - r.start).toBeLessThan(m.columns * 12)
    expect(r.start % m.columns).toBe(0)
  })

  it('末尾不越界，最后一行不满时 end 等于总数', () => {
    const count = 6 * 10 + 3
    const r = visibleRange(m, count, 1e9, 800, 2)
    expect(r.endRow).toBe(rowCount(m, count))
    expect(r.end).toBe(count)
    expect(r.start).toBeLessThanOrEqual(r.end)
  })

  it('网格上方有页眉（scrollTop 为负）时从第 0 行开始', () => {
    const r = visibleRange(m, 1000, -300, 800, 0)
    expect(r.startRow).toBe(0)
  })

  it('空列表', () => {
    expect(visibleRange(m, 0, 0, 800, 2)).toEqual({
      startRow: 0,
      endRow: 0,
      start: 0,
      end: 0,
    })
  })

  it('同一行内滚动区间不变（不触发重新渲染）', () => {
    const a = visibleRange(m, 50_000, 1000, 800, 2)
    const b = visibleRange(m, 50_000, 1001, 800, 2)
    expect(sameRange(a, b)).toBe(true)
  })
})

describe('位置与总高', () => {
  const m = gridMetrics(1200, OPTIONS)

  it('cellOffset 按行列算坐标', () => {
    expect(cellOffset(m, 0)).toEqual({ x: 0, y: 0 })
    const { x, y } = cellOffset(m, m.columns + 2)
    expect(y).toBe(m.rowStride)
    expect(x).toBe(Math.round(2 * (m.cellWidth + 24)))
  })

  it('总高 = 行数 × 步长 − 最后一行的行距', () => {
    expect(contentHeight(m, 0, 32)).toBe(0)
    expect(contentHeight(m, 13, 32)).toBe(3 * m.rowStride - 32)
  })
})
