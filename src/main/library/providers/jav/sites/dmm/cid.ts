/**
 * 番号 ↔ DMM 内容 ID（cid）互换，DMM 系站点（网页 / GraphQL / 官方 API）共用。
 *
 * FANZA 的 cid 规则：
 * - 数字版（配信）：前缀小写 + 数字补零到 5 位，SSIS-497 → ssis00497；
 * - DVD / 租赁版：前缀小写 + 原数字，SSIS-497 → ssis497；
 * - 部分厂牌在前面加厂商码：1stars00100、h_1133gone00078，尾部还可能带 a / so / hd 一类版本后缀。
 * 因此直接拼出来的 cid 只是第一猜测，拼不中要靠站内检索，再用 sameCid 核对检索结果。
 * 行为参考 Amane 的 dmm 爬虫，代码独立实现。
 */

/** 一个番号在 DMM 上的两种 cid 写法。 */
export interface DmmCid {
  /** 数字版写法：ssis00497。 */
  padded: string
  /** DVD 版写法：ssis497。 */
  short: string
}

/**
 * 番号 → cid 猜测。素人番号的数字前缀（259LUXU）去掉；认不出「字母 + 数字」结构返回 undefined。
 *
 * @param code 归一后的番号，如 SSIS-497、259LUXU-1234
 */
export function dmmCid(code: string): DmmCid | undefined {
  const m = /^\d*([a-z]+)[-_ ]?0*(\d+)$/i.exec(code.trim())
  if (!m) return undefined
  const prefix = m[1].toLowerCase()
  const digits = m[2].padStart(3, '0')
  return {
    padded: `${prefix}${digits.padStart(5, '0')}`,
    short: `${prefix}${digits}`,
  }
}

/** cid 去掉厂商码前缀（h_1133 / 1 / 118）与版本后缀，只留「字母 + 数字」主体，数字去前导零。 */
function cidCore(cid: string): string | undefined {
  const m = /^(?:h_\d+|\d+)?([a-z]+)0*(\d+)[a-z]*$/i.exec(cid.trim())
  return m ? `${m[1].toLowerCase()}${Number(m[2])}` : undefined
}

/**
 * 检索结果里的 cid 是不是这部片：主体相同即可（1stars00100、stars100 都对得上 STARS-100）。
 * 比较时数字去前导零，所以 ssis497 与 ssis00497 相同、与 ssis4970 不同。
 */
export function sameCid(found: string, target: DmmCid): boolean {
  const core = cidCore(found)
  return core !== undefined && core === cidCore(target.padded)
}

/**
 * 在一组候选 cid 里挑最合适的：完全等于猜测写法的优先，其次主体相同里最短的（不带版本后缀）。
 * 都对不上返回 undefined。
 */
export function pickCid(
  candidates: readonly string[],
  target: DmmCid
): string | undefined {
  const exact = candidates.find(
    c => c.toLowerCase() === target.padded || c.toLowerCase() === target.short
  )
  if (exact) return exact
  return candidates
    .filter(c => sameCid(c, target))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
}

/**
 * cid → 番号（页面上没写品番时用）：去厂商码前缀与版本后缀，数字至少 3 位。
 * ssis00497 → SSIS-497，h_1133gone00078 → GONE-078；认不出原样大写返回。
 */
export function cidToCode(cid: string): string {
  const m = /^(?:h_\d+|\d+)?([a-z]+)0*(\d+)[a-z]*$/i.exec(cid.trim())
  if (!m) return cid.toUpperCase()
  return `${m[1].toUpperCase()}-${m[2].padStart(3, '0')}`
}
