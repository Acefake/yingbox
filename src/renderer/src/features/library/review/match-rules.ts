/**
 * 匹配对照面板的纯规则：置信度分档、本地文件名截断、数字键选候选。不依赖 Vue，便于单测。
 */

/** 本地文件最多列出几个。 */
export const MAX_FILES = 4
/** 对照的候选数（也是数字键 1–3）。 */
export const SHOWN_CANDIDATES = 3

/** 置信度分档：≥ 0.8 高，≥ 0.6 中，其余低（颜色提示，阈值与引擎自动匹配线接近）。 */
export function confidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'is-high'
  if (confidence >= 0.6) return 'is-mid'
  return 'is-low'
}

/** 文件名截到前 max 个，more 为剩余个数（没有剩余时 ≤ 0）。 */
export function clipFiles(
  files: string[],
  max = MAX_FILES
): { shown: string[]; more: number } {
  return { shown: files.slice(0, max), more: files.length - max }
}

/** 数字键 → 候选序号（1 / 2 / 3 → 0 / 1 / 2），其他键返回 -1。 */
export function candidateKeyIndex(key: string): number {
  return ['1', '2', '3'].indexOf(key)
}
