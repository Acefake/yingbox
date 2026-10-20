/**
 * 中日韩文字判断与中文数字解析。
 */

/** 汉字、假名、谚文。 */
const CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** 文本里是否含中日韩文字。 */
export function hasCjk(text: string): boolean {
  return CJK_RE.test(text)
}

const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** 匹配阿拉伯数字或中文数字的正则片段。 */
export const NUMBER_PATTERN = '[0-9零〇一二两兩三四五六七八九十百千]+'

/**
 * 把阿拉伯数字或中文数字（十二、二十三、一百零五）转成整数；无法解析返回 undefined。
 */
export function parseNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text)
  let total = 0
  let current = 0
  for (const ch of text) {
    if (ch in DIGITS) {
      current = DIGITS[ch]
    } else if (ch in UNITS) {
      total += (current || 1) * UNITS[ch]
      current = 0
    } else {
      return undefined
    }
  }
  return total + current
}
