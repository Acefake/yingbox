/**
 * 把（已替换过标记的）文件名切成词、括号块、分隔符和标记占位。
 */
import { SENTINEL } from './markers'
import {
  GROUP_NAME_RE,
  HYPHEN_TAGS,
  SITE_PREFIX_RE,
  hasCjkTag,
  isAnyTag,
  isExtraWord,
} from './vocabulary'

/** 括号块的种类。 */
export type BracketKind = 'year' | 'number' | 'tag' | 'text'

/** 分词结果。 */
export type Token =
  | { kind: 'word'; text: string }
  | { kind: 'marker' }
  | { kind: 'dash' }
  | { kind: 'slash' }
  | { kind: 'bracket'; type: BracketKind; text: string; group: boolean }

const CLOSE: Record<string, string> = {
  '[': ']',
  '【': '】',
  '(': ')',
  '（': '）',
  '{': '}',
  '「': '」',
  '『': '』',
}
const BRACKET_CHARS = new Set([...Object.keys(CLOSE), ...Object.values(CLOSE)])
const SEPARATORS = new Set(['.', '_', ' ', '\t', '　'])
const ALNUM_RE = /[A-Za-z0-9]/
const PART_RE = /^(?:cd|dvd|disc|disk|part|pt)\d{1,2}$/i

/** 判断括号内容的种类。 */
function classifyBracket(text: string): BracketKind {
  if (/^(?:19|20)\d{2}$/.test(text)) return 'year'
  if (/^\d{1,4}(?:v\d)?$/.test(text)) return 'number'
  if (GROUP_NAME_RE.test(text)) return 'text'
  if (!text || SITE_PREFIX_RE.test(text) || hasCjkTag(text)) return 'tag'
  const words = text.split(/[\s._+\-/,&]+/).filter(Boolean)
  return words.some(isAnyTag) ? 'tag' : 'text'
}

/**
 * 词内连字符：整体是已知标记（WEB-DL）就保留；拆开后任一段是标记 / 附加内容词 / 分段词
 * （x264-GROUP、BLURAY-NTb、WEB-DL-sample）就拆开；否则视为片名的一部分（Spider-Man）。
 */
function splitHyphenWord(word: string): string[] {
  if (!word.includes('-') || HYPHEN_TAGS.has(word.toLowerCase())) return [word]
  const raw = word.split('-').filter(Boolean)
  const parts: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const pair = i + 1 < raw.length ? `${raw[i]}-${raw[i + 1]}` : ''
    if (pair && HYPHEN_TAGS.has(pair.toLowerCase())) {
      parts.push(pair)
      i++
    } else {
      parts.push(raw[i])
    }
  }
  // 附加内容词和分段词只认作后缀（Movie-trailer、x264-CD1），避免拆开 Extra-Terrestrial
  const last = parts[parts.length - 1]
  const meaningful =
    parts.some(p => isAnyTag(p)) || isExtraWord(last) || PART_RE.test(last)
  return meaningful ? parts : [word]
}

/** 切词。 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let word = ''
  const flush = (): void => {
    if (word) {
      for (const part of splitHyphenWord(word)) {
        tokens.push({ kind: 'word', text: part })
      }
    }
    word = ''
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === SENTINEL) {
      flush()
      tokens.push({ kind: 'marker' })
      continue
    }
    const close = CLOSE[ch]
    if (close) {
      const end = text.indexOf(close, i + 1)
      if (end > i) {
        flush()
        const inner = text.slice(i + 1, end).trim()
        tokens.push({
          kind: 'bracket',
          type: classifyBracket(inner),
          text: inner,
          group: GROUP_NAME_RE.test(inner),
        })
        i = end
        continue
      }
    }
    if (SEPARATORS.has(ch) || BRACKET_CHARS.has(ch)) {
      flush()
      continue
    }
    const prev = text[i - 1] ?? ''
    const next = text[i + 1] ?? ''
    if (ch === '-' || ch === '–' || ch === '—') {
      if (ALNUM_RE.test(prev) && ALNUM_RE.test(next) && ch === '-') {
        word += ch
      } else {
        flush()
        if (/\s/.test(prev) && /\s/.test(next)) tokens.push({ kind: 'dash' })
      }
      continue
    }
    if (ch === '/' || ch === '／') {
      flush()
      tokens.push({ kind: 'slash' })
      continue
    }
    word += ch
  }
  flush()
  return tokens
}
