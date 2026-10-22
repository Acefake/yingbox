/**
 * 智能体入口文件（AGENTS.md / CLAUDE.md）的篇幅预算：行数、字节数、最长一行。
 *
 * 每次读仓库都要整篇读进上下文，篇幅只能降不能升：细节下沉到 docs/（如 docs/adr/），入口只留索引。
 * 确需上调时，在同一改动里给对应项追加一条 [值, 日期, 理由]，理由写清为什么不能下沉；
 * 天花板（CEILING）不随记录上调。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Change = [value: number, date: string, reason: string]
type Metric = 'lines' | 'bytes' | 'longestLine'

/** 预算变更记录；当前预算取每项最后一条 */
const BUDGETS: Record<string, Record<Metric, Change[]>> = {
  'AGENTS.md': {
    lines: [[180, '2026-10-22', '初始值（加入工程门槛与 ADR 索引后 175 行）']],
    bytes: [[29 * 1024, '2026-10-22', '初始值（28 600 字节）']],
    longestLine: [[2450, '2026-10-22', '初始值（番号库一段 2438 字符）']],
  },
  'CLAUDE.md': {
    lines: [[170, '2026-10-22', '初始值（164 行）']],
    bytes: [[15 * 1024, '2026-10-22', '初始值（14 273 字节）']],
    longestLine: [[700, '2026-10-22', '初始值（693 字符）']],
  },
}

/** 记录也不能越过的天花板 */
const CEILING: Record<Metric, number> = {
  lines: 200,
  bytes: 32 * 1024,
  longestLine: 2500,
}

function measure(file: string): Record<Metric, number> {
  const text = readFileSync(file, 'utf8')
  const lines = text.replace(/\n$/, '').split('\n')
  return {
    lines: lines.length,
    bytes: Buffer.byteLength(text),
    longestLine: Math.max(...lines.map(line => line.length)),
  }
}

describe('入口文件篇幅预算', () => {
  for (const [file, metrics] of Object.entries(BUDGETS)) {
    it(`${file} 不超预算`, () => {
      const actual = measure(file)
      for (const [metric, changes] of Object.entries(metrics) as [
        Metric,
        Change[],
      ][]) {
        const budget = changes[changes.length - 1][0]
        expect(
          actual[metric],
          `${file} ${metric}：${actual[metric]} > 预算 ${budget}`
        ).toBeLessThanOrEqual(budget)
      }
    })
  }

  it('预算只降不升：上调必须写理由，且不越过天花板', () => {
    for (const [file, metrics] of Object.entries(BUDGETS)) {
      for (const [metric, changes] of Object.entries(metrics) as [
        Metric,
        Change[],
      ][]) {
        changes.forEach(([value, date, reason], i) => {
          expect(value, `${file} ${metric} 越过天花板`).toBeLessThanOrEqual(
            CEILING[metric]
          )
          expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          if (i > 0 && value > changes[i - 1][0])
            expect(
              reason,
              `${file} ${metric} 上调到 ${value} 缺理由`
            ).not.toMatch(/^$|初始值/)
        })
      }
    }
  })
})
