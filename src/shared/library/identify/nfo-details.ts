/**
 * 读取 Kodi / Jellyfin / Emby 风格 NFO 里的描述信息：类型、制片国家、评分、简介、年份。
 *
 * 与 nfo.ts 一样只做容错的正则抽取：TMDB 匹配失败、没配 TMDB 或 TMDB 缺字段时，
 * 用这些值补进 media_items（见 main/library/identify/nfo-fill.ts），不覆盖已有值。
 */
import { countryCodes } from './country-codes'

/** NFO 里的描述信息；没有的字段缺省（数组为空）。 */
export interface NfoDetails {
  genres: string[]
  /** ISO 3166-1 两位代码（名字已换算，认不出的丢弃）。 */
  countries: string[]
  /** 评分 0–10。 */
  rating?: number
  plot?: string
  year?: number
}

/** 单个类型 / 国家标签里常见的多值分隔符（「动作 / 冒险」「Action, Adventure」）。 */
const SPLIT_RE = /\s*[/|,，、;；]\s*/
/** 简介最长保留多少字。 */
const MAX_PLOT = 4000
/** 每类最多几个值。 */
const MAX_VALUES = 12

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 去掉 CDATA 包裹、解开常见 XML 实体、压缩空白。 */
export function xmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code > 0
          ? String.fromCodePoint(code)
          : whole
      }
      return ENTITIES[body.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** 某个标签的全部取值（不含嵌套标签的简单元素）。 */
function tagValues(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  const out: string[] = []
  for (const m of content.matchAll(re)) {
    const text = xmlText(m[1])
    if (text && !text.includes('<')) out.push(text)
  }
  return out
}

/** 多值标签：拆分隔符、去空、去重，限个数。 */
function listOf(content: string, tag: string): string[] {
  const out = new Set<string>()
  for (const value of tagValues(content, tag)) {
    for (const part of value.split(SPLIT_RE)) {
      const text = part.trim()
      if (text && text.length <= 40) out.add(text)
    }
  }
  return [...out].slice(0, MAX_VALUES)
}

/** 把 0–max 的分数换算到 0–10，保留一位小数；非法或为 0 返回 undefined。 */
function scaled(value: string, max: number): number | undefined {
  const n = Number(value.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0 || !(max > 0)) return undefined
  const score = (n / max) * 10
  return score > 10 ? undefined : Math.round(score * 10) / 10
}

/**
 * 评分：新式 <ratings><rating default="true" max="10"><value>8.1</value></rating></ratings>
 * 优先取 default 那一条，其次第一条；再退到旧式 <rating>8.1</rating>。
 */
function ratingOf(content: string): number | undefined {
  const block = /<ratings\b[^>]*>([\s\S]*?)<\/ratings>/i.exec(content)?.[1]
  if (block) {
    const entries = [
      ...block.matchAll(/<rating\b([^>]*)>([\s\S]*?)<\/rating>/gi),
    ].map(m => ({
      attrs: m[1],
      value: /<value>\s*([\d.,]+)\s*<\/value>/i.exec(m[2])?.[1],
    }))
    const pick =
      entries.find(e => /\bdefault\s*=\s*["']?true/i.test(e.attrs)) ??
      entries[0]
    if (pick?.value) {
      const max = Number(/\bmax\s*=\s*["']?([\d.]+)/i.exec(pick.attrs)?.[1])
      const score = scaled(pick.value, max > 0 ? max : 10)
      if (score !== undefined) return score
    }
  }
  const legacy = /<rating>\s*([\d.,]+)\s*<\/rating>/i.exec(content)?.[1]
  return legacy ? scaled(legacy, 10) : undefined
}

/** 年份：<year>，其次 <premiered> / <releasedate> / <aired> 里的四位年份。 */
function yearOf(content: string): number | undefined {
  for (const tag of ['year', 'premiered', 'releasedate', 'aired']) {
    const value = tagValues(content, tag)[0]
    const m = value && /\b(18|19|20)\d{2}\b/.exec(value)
    if (m) return Number(m[0])
  }
  return undefined
}

/** 解析 NFO 的描述信息。简介取 <plot>，没有时取 <outline>。 */
export function parseNfoDetails(content: string): NfoDetails {
  const plot = (
    tagValues(content, 'plot')[0] ?? tagValues(content, 'outline')[0]
  )?.slice(0, MAX_PLOT)
  const rating = ratingOf(content)
  const year = yearOf(content)
  return {
    genres: listOf(content, 'genre'),
    countries: countryCodes(listOf(content, 'country')),
    ...(rating !== undefined ? { rating } : {}),
    ...(plot ? { plot } : {}),
    ...(year !== undefined ? { year } : {}),
  }
}

/** 有没有任何可补的信息。 */
export const hasNfoDetails = (d: NfoDetails): boolean =>
  d.genres.length > 0 ||
  d.countries.length > 0 ||
  d.rating !== undefined ||
  d.plot !== undefined ||
  d.year !== undefined
