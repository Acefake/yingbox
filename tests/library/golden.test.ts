import { describe, expect, it } from 'vitest'
import { parseMediaPath } from '../../src/shared/library/parser'
import {
  type GoldenCategory,
  compareParse,
  goldenCases,
} from '../fixtures/media-names'

/** 整体准确率下限（P1 验收线）。 */
const OVERALL_MIN = 0.98
/** 任一分类的准确率下限，防止某一类整体退化被总数掩盖。 */
const CATEGORY_MIN = 0.95

describe('文件名解析黄金集', () => {
  const results = goldenCases.map(c => ({
    c,
    diff: compareParse(parseMediaPath(c.path), c.expected),
  }))

  it('黄金集规模不少于 2000 条', () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(2000)
  })

  it(`整体准确率 ≥ ${OVERALL_MIN * 100}%`, () => {
    const failed = results.filter(r => r.diff.length)
    const accuracy = 1 - failed.length / results.length
    expect(
      accuracy,
      failed
        .slice(0, 20)
        .map(r => `${r.c.path}: ${JSON.stringify(r.diff)}`)
        .join('\n')
    ).toBeGreaterThanOrEqual(OVERALL_MIN)
  })

  it(`每个分类准确率 ≥ ${CATEGORY_MIN * 100}%`, () => {
    const byCategory = new Map<GoldenCategory, { ok: number; total: number }>()
    for (const { c, diff } of results) {
      const t = byCategory.get(c.category) ?? { ok: 0, total: 0 }
      t.total++
      if (!diff.length) t.ok++
      byCategory.set(c.category, t)
    }
    const below = [...byCategory]
      .filter(([, t]) => t.ok / t.total < CATEGORY_MIN)
      .map(([cat, t]) => `${cat}: ${t.ok}/${t.total}`)
    expect(below).toEqual([])
  })
})
