/**
 * .torrent 文件 → infohash：按 bencode 走一遍顶层字典，取 info 值的原始字节做 SHA-1；
 * 顺带取名字（info.name）与 tracker（announce / announce-list），拼磁力时用。
 * 只认 v1 种子（SHA-1 btih）；格式不对时返回 null，不抛错。
 */
import { createHash } from 'node:crypto'

/** 从种子里读出的信息 */
export interface TorrentInfo {
  hash: string
  name: string
  trackers: string[]
}

type Value = number | Uint8Array | Value[] | Map<string, Value>

/** 最大嵌套层数（防恶意深度） */
const MAX_DEPTH = 64

/** bencode 读取器：返回值与结束位置；不合法抛错 */
function read(data: Uint8Array, start: number, depth: number): [Value, number] {
  if (depth > MAX_DEPTH) throw new Error('nested')
  const head = data[start]
  if (head === 0x69) {
    // i<数字>e
    const end = data.indexOf(0x65, start)
    if (end < 0) throw new Error('int')
    return [
      Number(Buffer.from(data.subarray(start + 1, end)).toString()),
      end + 1,
    ]
  }
  if (head === 0x6c || head === 0x64) {
    // l…e / d…e
    const list: Value[] = []
    const dict = new Map<string, Value>()
    let pos = start + 1
    while (data[pos] !== 0x65) {
      if (pos >= data.length) throw new Error('eof')
      if (head === 0x6c) {
        const [value, next] = read(data, pos, depth + 1)
        list.push(value)
        pos = next
      } else {
        const [key, afterKey] = read(data, pos, depth + 1)
        if (!(key instanceof Uint8Array)) throw new Error('key')
        const [value, next] = read(data, afterKey, depth + 1)
        dict.set(Buffer.from(key).toString('utf8'), value)
        pos = next
      }
    }
    return [head === 0x6c ? list : dict, pos + 1]
  }
  // <长度>:<字节>
  const colon = data.indexOf(0x3a, start)
  if (colon < 0) throw new Error('str')
  const length = Number(Buffer.from(data.subarray(start, colon)).toString())
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('len')
  const end = colon + 1 + length
  if (end > data.length) throw new Error('eof')
  return [data.subarray(colon + 1, end), end]
}

const textOf = (value: Value | undefined): string =>
  value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''

/** 种子字节 → infohash 等；不是合法 v1 种子时 null */
export function parseTorrent(data: Uint8Array): TorrentInfo | null {
  if (data[0] !== 0x64) return null
  try {
    let pos = 1
    let info: { start: number; end: number; value: Value } | null = null
    const top = new Map<string, Value>()
    while (data[pos] !== 0x65) {
      if (pos >= data.length) return null
      const [key, afterKey] = read(data, pos, 1)
      if (!(key instanceof Uint8Array)) return null
      const [value, next] = read(data, afterKey, 1)
      const name = Buffer.from(key).toString('utf8')
      if (name === 'info') info = { start: afterKey, end: next, value }
      top.set(name, value)
      pos = next
    }
    if (!info || !(info.value instanceof Map)) return null
    const hash = createHash('sha1')
      .update(data.subarray(info.start, info.end))
      .digest('hex')
    const trackers = new Set<string>()
    const announce = textOf(top.get('announce'))
    if (announce) trackers.add(announce)
    const tiers = top.get('announce-list')
    if (Array.isArray(tiers))
      for (const tier of tiers)
        if (Array.isArray(tier))
          for (const url of tier) if (textOf(url)) trackers.add(textOf(url))
    return {
      hash,
      name: textOf(info.value.get('name')),
      trackers: [...trackers].filter(url => /^(udp|https?):\/\//i.test(url)),
    }
  } catch {
    return null
  }
}
