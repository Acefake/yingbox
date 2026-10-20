/**
 * 归一化标题之间的相似度，取值 0–1。
 */

/** 按码点计算的编辑距离（两行滚动数组）。 */
function levenshtein(a: string[], b: string[]): number {
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/**
 * 两个**已归一化**标题的相似度：
 * - 词集合相同（词序不同）记 1；
 * - 否则取去空格后按码点的编辑距离比例 1 - d / max(len)。
 */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const setA = [...new Set(a.split(' '))].sort().join(' ')
  const setB = [...new Set(b.split(' '))].sort().join(' ')
  if (setA === setB) return 1
  const ca = [...a.replace(/ /g, '')]
  const cb = [...b.replace(/ /g, '')]
  return 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length)
}
