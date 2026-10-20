/**
 * 标题归一化：繁简统一、全角转半角、去重音、去标点、罗马数字转阿拉伯数字、& → and、去前置冠词。
 *
 * 归一化对查询和候选两边做同样的变换，所以即使某条规则偶尔“改错”，两边也会一起改错，
 * 不影响比较结果。
 */
import { Converter } from 'opencc-js/t2cn'

let toSimplified: ((text: string) => string) | undefined

const ROMAN: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
  xvi: '16',
  xvii: '17',
  xviii: '18',
  xix: '19',
  xx: '20',
}
/** 只有前面是这些词时，单个 i 才当罗马数字 1（Part I、Chapter I）。 */
const ROMAN_ONE_CONTEXT = new Set([
  'part',
  'chapter',
  'vol',
  'volume',
  'episode',
  'book',
])
const LEADING_ARTICLE_RE = /^(?:the|a|an) /
const TRAILING_ARTICLE_RE = / (?:the|a|an)$/

/**
 * 归一化一个标题，结果是空格分隔的小写词；空标题返回空串。
 */
export function normalizeTitle(title: string): string {
  toSimplified ??= Converter({ from: 'tw', to: 'cn' })
  const words = toSimplified(title.normalize('NFKC'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  const converted = words.map((w, i) => {
    if (w === 'i') return ROMAN_ONE_CONTEXT.has(words[i - 1] ?? '') ? '1' : w
    return ROMAN[w] ?? w
  })
  return converted
    .join(' ')
    .replace(LEADING_ARTICLE_RE, '')
    .replace(TRAILING_ARTICLE_RE, '')
}
