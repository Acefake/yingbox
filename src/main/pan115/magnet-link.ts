/**
 * 磁力 / 电驴链接：解析出去重键（btih 小写十六进制、ed2k 哈希），合并多来源结果并排序。
 *
 * - magnet：xt=urn:btih: 后是 40 位十六进制或 32 位 base32（统一转成十六进制）；dn 当名字、xl 当大小；
 * - ed2k：ed2k://|file|名字|字节数|32 位哈希|/；
 * 同一个哈希只留一条：Torznab 的（带做种数）优先，缺的字段用另一条补；按做种数、大小降序，最多 {@link MAX_MAGNETS} 条。
 */
import type { MagnetItem } from '../../shared/contract/pan115'

/** 一次搜索最多返回的磁力条数 */
export const MAX_MAGNETS = 100

/** 解析出的链接 */
export interface ParsedLink {
  kind: MagnetItem['kind']
  hash: string
  name: string
  size?: number
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** 32 位 base32 → 40 位十六进制；不合法为空串 */
function base32ToHex(value: string): string {
  let bits = ''
  for (const char of value.toUpperCase()) {
    const index = BASE32.indexOf(char)
    if (index < 0) return ''
    bits += index.toString(2).padStart(5, '0')
  }
  let hex = ''
  for (let i = 0; i + 4 <= bits.length; i += 4)
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** 字符串 → 非负整数；不是时 undefined */
function sizeOf(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 ? size : undefined
}

/** btih（十六进制或 base32）→ 小写十六进制；不合法为空串 */
export function normalizeInfoHash(value: string): string {
  const trimmed = value.trim()
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.toLowerCase()
  if (/^[a-z2-7]{32}$/i.test(trimmed)) return base32ToHex(trimmed)
  return ''
}

/** 解码 URL 分量；坏编码时原样返回 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** magnet:? 链接 → 哈希 / 名字 / 大小；不是 btih 磁力时 null */
export function parseMagnet(url: string): ParsedLink | null {
  const trimmed = url.trim()
  if (!/^magnet:\?/i.test(trimmed)) return null
  let hash = ''
  let name = ''
  let size: number | undefined
  for (const pair of trimmed.slice(8).split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq).toLowerCase()
    const value = decode(pair.slice(eq + 1))
    if (key === 'xt' && !hash) {
      const match = /^urn:btih:([0-9a-z]+)$/i.exec(value)
      if (match) hash = normalizeInfoHash(match[1])
    } else if (key === 'dn' && !name) name = value
    else if (key === 'xl') size = sizeOf(value)
  }
  return hash ? { kind: 'magnet', hash, name, size } : null
}

/** ed2k://|file|… 链接 → 哈希 / 名字 / 大小；不合法时 null */
export function parseEd2k(url: string): ParsedLink | null {
  const match = /^ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([0-9a-f]{32})\|/i.exec(
    url.trim()
  )
  if (!match) return null
  return {
    kind: 'ed2k',
    hash: match[3].toLowerCase(),
    name: decode(match[1]),
    size: sizeOf(match[2]),
  }
}

/** 任一种链接 → 解析结果；都不是时 null */
export function parseOfflineLink(url: string): ParsedLink | null {
  return parseMagnet(url) ?? parseEd2k(url)
}

/** 由哈希拼磁力链接（带名字与 tracker） */
export function magnetOf(
  hash: string,
  name = '',
  trackers: readonly string[] = []
): string {
  const parts = [`xt=urn:btih:${hash}`]
  if (name) parts.push(`dn=${encodeURIComponent(name)}`)
  for (const tracker of trackers.slice(0, 10))
    parts.push(`tr=${encodeURIComponent(tracker)}`)
  return `magnet:?${parts.join('&')}`
}

/** 合并后排序用：没有做种数的排在有的后面 */
const seedRank = (item: MagnetItem): number => item.seeders ?? -1

/**
 * 合并多来源的磁力：按 kind + 哈希去重（Torznab 优先，缺的字段互补），做种数、大小降序，截断到上限。
 */
export function mergeMagnets(
  lists: ReadonlyArray<readonly MagnetItem[]>,
  limit = MAX_MAGNETS
): MagnetItem[] {
  const byKey = new Map<string, MagnetItem>()
  for (const list of lists)
    for (const item of list) {
      const key = `${item.kind}:${item.hash}`
      const seen = byKey.get(key)
      if (!seen) {
        byKey.set(key, item)
        continue
      }
      const [main, other] =
        item.origin === 'torznab' && seen.origin !== 'torznab'
          ? [item, seen]
          : [seen, item]
      byKey.set(key, {
        ...main,
        size: main.size ?? other.size,
        seeders: main.seeders ?? other.seeders,
        peers: main.peers ?? other.peers,
        datetime: main.datetime ?? other.datetime,
      })
    }
  return [...byKey.values()]
    .sort((a, b) => seedRank(b) - seedRank(a) || (b.size ?? 0) - (a.size ?? 0))
    .slice(0, limit)
}
