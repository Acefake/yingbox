/**
 * XMLTV 节目单的纯解析规则：时间格式、实体解码、频道 / 节目提取、频道名归一与匹配。
 *
 * 主进程下载解压后调用 {@link parseXmltv}，再用 {@link buildEpgIndex} 建索引供按频道查询；
 * 不依赖任何模块，便于单测。节目单动辄几十 MB，这里用正则顺序扫描而不建 DOM。
 */
import type { EpgProgramme } from '../contract/iptv'

/** 节目单里的一个频道 */
export interface XmltvChannel {
  id: string
  /** display-name，可能有多个（不同语言 / 别名） */
  names: string[]
}

/** 解析结果：频道表 + 按频道 id 分组、按开始时间排好的节目 */
export interface XmltvData {
  channels: XmltvChannel[]
  programmes: Record<string, EpgProgramme[]>
}

/** 只保留与 [from, to) 有交集的节目（省内存）；不传则全部保留 */
export interface XmltvRange {
  from: number
  to: number
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** 解码 XML 实体与 CDATA，并去掉首尾空白 */
export function decodeXmlText(raw: string): string {
  const text = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      return ENTITIES[body.toLowerCase()] ?? whole
    })
    .trim()
}

/** 解析标签属性：`a="1" b='2'` → { a: '1', b: '2' } */
export function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) attrs[m[1]] = decodeXmlText(m[2] ?? m[3] ?? '')
  return attrs
}

/**
 * XMLTV 时间：`YYYYMMDDhhmmss ±hhmm`（秒、时区可省）。无时区按 UTC。
 * @returns 毫秒时间戳；格式不对返回 null
 */
export function parseXmltvTime(value: string | undefined): number | null {
  const m =
    /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}:?\d{2})?/.exec(
      value ?? ''
    )
  if (!m) return null
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  if (!Number.isFinite(utc)) return null
  if (!m[7]) return utc
  const sign = m[7][0] === '-' ? -1 : 1
  const digits = m[7].slice(1).replace(':', '')
  const offset = (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60_000
  return utc - sign * offset
}

/** 取第一个指定标签的文本 */
function firstTag(body: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body)
  return m ? decodeXmlText(m[1]) : ''
}

/** 取全部指定标签的文本 */
function allTags(body: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const text = decodeXmlText(m[1])
    if (text) out.push(text)
  }
  return out
}

/** 解析 XMLTV 文档 */
export function parseXmltv(xml: string, range?: XmltvRange): XmltvData {
  const channels: XmltvChannel[] = []
  const channelRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g
  let m: RegExpExecArray | null
  while ((m = channelRe.exec(xml))) {
    const id = parseAttributes(m[1]).id
    if (id) channels.push({ id, names: allTags(m[2], 'display-name') })
  }

  const programmes: Record<string, EpgProgramme[]> = {}
  const programmeRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g
  while ((m = programmeRe.exec(xml))) {
    const attrs = parseAttributes(m[1])
    const start = parseXmltvTime(attrs.start)
    const stop = parseXmltvTime(attrs.stop)
    if (!attrs.channel || start === null) continue
    const end = stop !== null && stop > start ? stop : start
    if (range && (end <= range.from || start >= range.to)) continue
    const title = firstTag(m[2], 'title')
    ;(programmes[attrs.channel] ??= []).push({ start, stop: end, title })
  }
  for (const list of Object.values(programmes)) fixProgrammes(list)
  return { channels, programmes }
}

/** 按开始时间排序；缺结束时间的节目用下一档的开始时间补上 */
function fixProgrammes(list: EpgProgramme[]): void {
  list.sort((a, b) => a.start - b.start)
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1]
    if (list[i].stop <= list[i].start && next) list[i].stop = next.start
  }
}

const QUALITY_WORDS =
  /(超高清|高清|超清|标清|蓝光|频道|uhd|fhd|hd|4k|8k|1080p|720p)/g

/**
 * 频道名归一：全角转半角、小写、去掉空白与标点、去掉清晰度后缀，CCTV-1 综合 → cctv1。
 * 用于 m3u 频道名与节目单 display-name 的模糊匹配。
 */
export function normalizeChannelName(name: string): string {
  const base = name.normalize('NFKC').toLowerCase()
  const cctv = /^cctv[\s-_]*(\d+\+?|4k|8k)/.exec(base)
  if (cctv) return `cctv${cctv[1]}`
  return base
    .replace(/[\s\-_·.|:：()（）[\]【】]/g, '')
    .replace(QUALITY_WORDS, '')
}

/** 节目单索引：频道 id → 节目；归一名 / 原始 id → 频道 id */
export interface EpgIndex {
  programmes: Map<string, EpgProgramme[]>
  ids: Set<string>
  byName: Map<string, string>
}

/** 由解析结果建索引（同名先到先得） */
export function buildEpgIndex(data: XmltvData): EpgIndex {
  const byName = new Map<string, string>()
  const ids = new Set<string>()
  for (const channel of data.channels) {
    ids.add(channel.id)
    for (const name of [...channel.names, channel.id]) {
      const key = normalizeChannelName(name)
      if (key && !byName.has(key)) byName.set(key, channel.id)
    }
  }
  const programmes = new Map(Object.entries(data.programmes))
  for (const id of programmes.keys()) ids.add(id)
  return { programmes, ids, byName }
}

/**
 * 在索引里找频道：先按 tvg-id 精确匹配，再按 tvg-id / 频道名归一后匹配 display-name。
 * @returns 节目单里的频道 id；找不到返回 undefined
 */
export function matchEpgChannel(
  index: EpgIndex,
  query: { tvgId?: string; names: string[] }
): string | undefined {
  if (query.tvgId && index.ids.has(query.tvgId)) return query.tvgId
  for (const name of [query.tvgId ?? '', ...query.names]) {
    const key = name && normalizeChannelName(name)
    const id = key ? index.byName.get(key) : undefined
    if (id) return id
  }
  return undefined
}

/** 与 [from, to) 有交集的节目 */
export function programmesBetween(
  list: readonly EpgProgramme[],
  from: number,
  to: number
): EpgProgramme[] {
  return list.filter(p => p.stop > from && p.start < to)
}
