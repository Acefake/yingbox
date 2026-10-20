/**
 * 文件名解析黄金集入口：手写难例 + 规则生成用例。
 */
import { generateGoldenCases } from './generate'
import { hardCases } from './hard-cases'
import type { GoldenCase } from './types'

export type { GoldenCase, GoldenCategory, GoldenExpected } from './types'
export { compareParse, type FieldMismatch } from './compare'

/** 全部黄金用例（顺序稳定）。 */
export const goldenCases: GoldenCase[] = [
  ...hardCases,
  ...generateGoldenCases(),
]
