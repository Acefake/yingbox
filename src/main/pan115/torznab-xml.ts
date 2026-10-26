/**
 * Torznab 响应 XML 的解析：搜索结果（RSS item + torznab:attr）与错误（<error code description/>）。
 * 结构固定且简单，用正则逐条取字段，不引 XML 解析库；每条优先取 magneturl / magnet: 链接 / infohash，
 * 都没有时留下 .torrent 下载地址给 torznab.ts 解析。
 */
import { Pan115Error } from './errors'
import { isOfflineScheme } from './http'
import { magnetOf, normalizeInfoHash } from './magnet-link'

/** 一个接口最多读几条 item */
const MAX_ITEMS = 300
const MAX_TITLE = 200
const LABEL = 'Torznab'

/** XML 里读出的一条（还没变成磁力） */
export interface TorznabEntry {
  title: string
  indexer: string
  datetime?: string
  size?: number
  seeders?: number
  peers?: number
  /** 已知的磁力 / 电驴链接 */
  link?: string
  /** 只有种子下载地址时 */
  download?: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** 反转义 XML 文本（含 CDATA 与数字实体） */
export function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  if (cdata) return cdata[1].trim()
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : whole
    })
    .trim()
}

/** 元素里的文本（第一个同名元素）；没有为空串 */
function tag(xml: string, name: string): string {
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,
    'i'
  ).exec(xml)
  return match ? xmlText(match[1]) : ''
}

/** 元素的某个属性（第一个同名元素）；没有为空串 */
export function attrOf(xml: string, name: string, attr: string): string {
  const element = new RegExp(`<${name}\\s[^>]*>`, 'i').exec(xml)
  if (!element) return ''
  const match = new RegExp(
    `\\s${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`,
    'i'
  ).exec(element[0])
  return match ? xmlText(match[2] ?? match[3] ?? '') : ''
}

/** torznab:attr name=… value=… 全部读成表 */
function torznabAttrs(xml: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const element of xml.matchAll(/<(?:torznab|newznab):attr\s[^>]*>/gi)) {
    const name = /\sname\s*=\s*["']([^"']*)["']/i.exec(element[0])?.[1]
    const value = /\svalue\s*=\s*("([^"]*)"|'([^']*)')/i.exec(element[0])
    if (name && value && !attrs.has(name.toLowerCase()))
      attrs.set(name.toLowerCase(), xmlText(value[2] ?? value[3] ?? ''))
  }
  return attrs
}

const count = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value.trim())) return undefined
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : undefined
}

/** 错误码 → 人话 */
function errorMessage(code: string, description: string): string {
  if (code === '100') return 'API Key 不对'
  if (code === '101' || code === '102') return '账号不可用'
  return description || `错误码 ${code}`
}

/** Torznab 错误响应 <error code=… description=…/>；不是错误时 null */
export function torznabError(xml: string): Pan115Error | null {
  if (!/<error\s/i.test(xml) || /<item[\s>]/i.test(xml)) return null
  const code = attrOf(xml, 'error', 'code')
  return new Pan115Error(
    `${LABEL}：${errorMessage(code, attrOf(xml, 'error', 'description'))}`,
    Number(code) || undefined
  )
}

/** 解析搜索结果 XML；错误响应抛 {@link Pan115Error} */
export function parseTorznab(
  xml: string,
  fallbackIndexer: string
): TorznabEntry[] {
  const failure = torznabError(xml)
  if (failure) throw failure
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml))
    throw new Pan115Error(`${LABEL} 返回的不是 RSS`)
  const channel = tag(xml.replace(/<item[\s>][\s\S]*$/i, ''), 'title')
  const entries: TorznabEntry[] = []
  for (const match of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    if (entries.length >= MAX_ITEMS) break
    const item = match[1]
    const attrs = torznabAttrs(item)
    const title = tag(item, 'title').slice(0, MAX_TITLE)
    if (!title) continue
    const candidates = [
      attrs.get('magneturl') ?? '',
      tag(item, 'link'),
      attrOf(item, 'enclosure', 'url'),
      tag(item, 'guid'),
    ]
    let link = candidates.find(url => isOfflineScheme(url))
    const hash = normalizeInfoHash(attrs.get('infohash') ?? '')
    if (!link && hash) link = magnetOf(hash, title)
    const download = link
      ? undefined
      : candidates.slice(1, 3).find(url => /^https?:\/\//i.test(url))
    if (!link && !download) continue
    const date = new Date(tag(item, 'pubDate'))
    const seeders = count(attrs.get('seeders'))
    const peers = count(attrs.get('peers'))
    entries.push({
      title,
      indexer:
        tag(item, 'jackettindexer') ||
        tag(item, 'prowlarrindexer') ||
        tag(item, 'indexer') ||
        channel ||
        fallbackIndexer,
      datetime: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
      size:
        count(tag(item, 'size')) ??
        count(attrs.get('size')) ??
        count(attrOf(item, 'enclosure', 'length')),
      seeders,
      // Torznab 的 peers 含做种的人；这里只要下载中的
      peers:
        peers !== undefined && seeders !== undefined
          ? Math.max(0, peers - seeders)
          : peers,
      link,
      download,
    })
  }
  return entries
}
