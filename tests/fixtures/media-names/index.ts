/**
 * 文件名解析黄金集入口：手写难例 + 留出集 + 规则生成用例。
 */
import { generateGoldenCases } from './generate'
import { hardCases } from './hard-cases'
import { holdoutCases } from './holdout-cases'
import type { GoldenCase } from './types'

export type { GoldenCase, GoldenCategory, GoldenExpected } from './types'
export { compareParse, type FieldMismatch } from './compare'

/** 全部黄金用例（顺序稳定）。 */
export const goldenCases: GoldenCase[] = [
  ...hardCases,
  ...holdoutCases,
  ...generateGoldenCases(),
]

/** 留出集路径（基准里单独统计）。 */
export const holdoutPaths: ReadonlySet<string> = new Set(
  holdoutCases.map(c => c.path)
)
