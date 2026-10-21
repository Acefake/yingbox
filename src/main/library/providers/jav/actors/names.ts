/**
 * 演员资料解析共用的小工具：名字归一 / 比较、尾部注记括号、日历日期、正整数。纯函数。
 */

/** 名字取值归一：NFKC 折叠 + 压缩空白 + 去首尾空白，保留大小写。 */
export function normalizeName(value: string | undefined | null): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** 两个名字是否同一写法：归一后大小写无关相等；任一侧为空为假。 */
export function sameName(a: string, b: string): boolean {
  const x = normalizeName(a).toLowerCase()
  return x !== '' && x === normalizeName(b).toLowerCase()
}

/** 名字列表里有没有和 name 同写法的。 */
export function hasName(names: readonly string[], name: string): boolean {
  return names.some(n => sameName(n, name))
}

const TRAILING_PAREN = /^(.+?)\s*[（(][^（）()]*[）)]\s*$/

/** 去掉名字尾部的注记括号：「相川美羽(tenshigao)」「鬼頭桃菜(SKE48チームE)」→ 本名。 */
export function stripAnnotations(name: string): string {
  let current = normalizeName(name)
  for (;;) {
    const m = TRAILING_PAREN.exec(current)
    if (!m) return current
    current = m[1].trim()
  }
}

/** 去重保序、去空、去掉与 exclude 同写法的项。 */
export function uniqueNames(
  values: Array<string | undefined>,
  exclude?: string
): string[] {
  const out: string[] = []
  for (const raw of values) {
    const value = normalizeName(raw)
    if (!value || (exclude && sameName(value, exclude))) continue
    if (!hasName(out, value)) out.push(value)
  }
  return out
}

const DATE_PATTERNS = [
  /(\d{4})-(\d{1,2})-(\d{1,2})/,
  /(\d{4})[/.](\d{1,2})[/.](\d{1,2})/,
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
]

/**
 * 日历日期 → YYYY-MM-DD：认 1993-08-16、1993/8/16、1993年08月16日、维基数据的 +1993-08-16T00:00:00Z；
 * 后面带的「（現在 32歳）」之类不影响。日期不合法返回 undefined。
 */
export function calendarDate(
  text: string | undefined | null
): string | undefined {
  const value = text?.normalize('NFKC')
  if (!value) return undefined
  for (const pattern of DATE_PATTERNS) {
    const m = pattern.exec(value)
    if (!m) continue
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const date = new Date(Date.UTC(y, mo - 1, d))
    if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
      return undefined
    return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return undefined
}

/** 正整数：数字或纯数字串（"159"、"+159"）；其余返回 undefined。 */
export function positiveInt(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\+?\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}
