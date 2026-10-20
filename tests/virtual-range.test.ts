import { describe, expect, it } from 'vitest'
import {
  INITIAL_RENDER,
  countColumns,
  measureStride,
  visibleRange,
} from '@/components/ui/virtual-range'

describe('visibleRange', () => {
  const base = { count: 10_000, columns: 5, stride: 200, viewHeight: 800 }

  it('顶部：只渲染首屏加 overscan 行', () => {
    const r = visibleRange({ ...base, viewTop: 0, overscan: 2 })
    // 视口覆盖 0..4 行，下方再多 2 行 → 0..6 行
    expect(r).toEqual({
      start: 0,
      end: 6 * 5,
      padTop: 0,
      padBottom: (2000 - 6) * 200,
    })
  })

  it('中段：上下占位 + 渲染行高 = 总高度，渲染条数与总数无关', () => {
    const r = visibleRange({ ...base, viewTop: 100_000, overscan: 2 })
    expect(r.start).toBe((500 - 2) * 5)
    expect(r.end).toBe((504 + 2) * 5)
    expect(r.padTop).toBe(498 * 200)
    const renderedRows = (r.end - r.start) / 5
    expect(r.padTop + renderedRows * 200 + r.padBottom).toBe(2000 * 200)
    expect(r.end - r.start).toBeLessThan(60)
  })

  it('滚到底：最后一行不满也渲染到末尾，下方无占位', () => {
    const r = visibleRange({ ...base, count: 10_003, viewTop: 400_000 })
    expect(r.end).toBe(10_003)
    expect(r.padBottom).toBe(0)
  })

  it('列表在视口下方（viewTop 为负）时从 0 开始', () => {
    const r = visibleRange({ ...base, viewTop: -500, overscan: 1 })
    expect(r.start).toBe(0)
    expect(r.padTop).toBe(0)
    expect(r.end).toBe(3 * 5)
  })

  it('还没量到行距时先渲染一屏用来测量', () => {
    const r = visibleRange({ ...base, stride: 0, viewTop: 0 })
    expect(r).toEqual({
      start: 0,
      end: INITIAL_RENDER,
      padTop: 0,
      padBottom: 0,
    })
    expect(visibleRange({ ...base, count: 3, stride: 0, viewTop: 0 }).end).toBe(
      3
    )
  })

  it('空列表与非法列数', () => {
    expect(visibleRange({ ...base, count: 0, viewTop: 0 }).end).toBe(0)
    const r = visibleRange({ ...base, columns: 0, viewTop: 0, overscan: 0 })
    expect(r.end).toBe(4)
  })

  it('列数变化（窗口变窄）后同一视口渲染更多条、行号不变', () => {
    const wide = visibleRange({ ...base, viewTop: 10_000, overscan: 0 })
    const narrow = visibleRange({
      ...base,
      columns: 3,
      viewTop: 10_000,
      overscan: 0,
    })
    expect(wide.start / 5).toBe(narrow.start / 3)
    expect(narrow.padTop).toBe(wide.padTop)
  })
})

describe('countColumns', () => {
  it('数解析后的轨道', () => {
    expect(countColumns('260px 260px 260px')).toBe(3)
    expect(countColumns(' 120.5px  120.5px ')).toBe(2)
  })
  it('非 grid 按 1 列', () => {
    expect(countColumns('none')).toBe(1)
    expect(countColumns('')).toBe(1)
  })
  it('忽略命名网格线', () => {
    expect(countColumns('[a] 100px [b c] 100px [d]')).toBe(2)
  })
})

describe('measureStride', () => {
  it('有多行时取首行到末行的平均行距（含 gap 和外边距）', () => {
    expect(measureStride(10, 180, 222, 1, 24)).toBe(212)
    // 中间某行高了 6px，摊到 3 行上
    expect(measureStride(0, 180, 642, 3, 24)).toBe(214)
  })
  it('只有一行时取高度 + row-gap', () => {
    expect(measureStride(10, 180, null, 0, 24)).toBe(204)
    expect(measureStride(10, 180, null, 0, Number.NaN)).toBe(180)
  })
  it('量不到返回 0', () => {
    expect(measureStride(0, 0, null, 0, 10)).toBe(0)
  })
})
