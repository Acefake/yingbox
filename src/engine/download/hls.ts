/**
 * HLS 下载：解析 m3u8（主清单选最高码率），并发拉分片、按序写盘，支持 AES-128 与 fMP4（EXT-X-MAP）。
 *
 * 取代原 Python 下载器调用的 m3u8-Downloader-Go 外部程序。解析部分是纯函数，单测直接覆盖。
 */
import { createDecipheriv } from 'node:crypto'
import { access, rename, rm } from 'node:fs/promises'
import type { NetClient } from '../../shared/net/client'
import {
  SEGMENT_LOG_SUFFIX,
  type SegmentWriter,
  openSegmentWriter,
  playlistFingerprint,
} from './resume'

/** 分片加密信息。 */
export interface SegmentKey {
  uri: string
  /** 16 字节 IV；缺省时用分片序号 */
  iv?: Buffer
}

/** 一个媒体分片。 */
export interface Segment {
  uri: string
  sequence: number
  key?: SegmentKey
}

/** 解析后的媒体清单。 */
export interface MediaPlaylist {
  segments: Segment[]
  /** fMP4 初始化段 */
  map?: string
}

const attr = (line: string, name: string): string | undefined => {
  const m = line.match(new RegExp(`${name}=("([^"]*)"|[^,]*)`))
  return m ? (m[2] ?? m[1]) : undefined
}

/** 是否主清单（含 EXT-X-STREAM-INF）。 */
export const isMasterPlaylist = (text: string): boolean =>
  text.includes('#EXT-X-STREAM-INF')

/** 主清单里码率最高的变体地址（已按 base 解析成绝对地址）。 */
export function pickBestVariant(text: string, base: string): string {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('不是 m3u8 清单')
  const lines = text.split(/\r?\n/).map(l => l.trim())
  let best: { bandwidth: number; uri: string } | undefined
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number(attr(lines[i], 'BANDWIDTH') ?? 0)
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'))
    if (uri && (!best || bandwidth > best.bandwidth)) best = { bandwidth, uri }
  }
  if (!best) throw new Error('主清单里没有可用的码流')
  return new URL(best.uri, base).toString()
}

/** 解析媒体清单：分片、序号、AES-128 密钥、初始化段。 */
export function parseMediaPlaylist(text: string, base: string): MediaPlaylist {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('不是 m3u8 清单')
  const segments: Segment[] = []
  let sequence = 0
  let key: SegmentKey | undefined
  let map: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.split(':')[1]) || 0
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const method = attr(line, 'METHOD')
      if (method === 'NONE') key = undefined
      else if (method === 'AES-128') {
        const uri = attr(line, 'URI')
        if (!uri) throw new Error('加密清单缺少密钥地址')
        const iv = attr(line, 'IV')
        key = {
          uri: new URL(uri, base).toString(),
          iv: iv
            ? Buffer.from(iv.replace(/^0x/i, '').padStart(32, '0'), 'hex')
            : undefined,
        }
      } else throw new Error(`不支持的加密方式：${method}`)
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attr(line, 'URI')
      if (uri) map = new URL(uri, base).toString()
    } else if (!line.startsWith('#')) {
      segments.push({
        uri: new URL(line, base).toString(),
        sequence: sequence++,
        key,
      })
    }
  }
  if (!segments.length) throw new Error('清单里没有分片')
  return { segments, map }
}

/** 分片序号 → 默认 IV（大端 16 字节）。 */
export function sequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16)
  iv.writeUInt32BE(sequence >>> 0, 12)
  return iv
}

/** AES-128-CBC 解密一个分片。 */
export function decryptSegment(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

/** 下载进度。 */
export interface HlsProgress {
  done: number
  total: number
  bytes: number
}

/** 下载选项。 */
export interface HlsOptions {
  referer?: string
  concurrency?: number
  retries?: number
  signal?: AbortSignal
  onProgress?: (p: HlsProgress) => void
}

/** 下载结果：fMP4 清单产出 mp4，否则产出 MPEG-TS。 */
export interface HlsResult {
  file: string
  container: 'ts' | 'mp4'
}

/**
 * 下载整个 HLS 流到 `outBase` + 扩展名。先写 .partial，完成后原子改名。
 * 分片并发下载、按序写入，内存里最多同时持有 concurrency 个分片。
 *
 * 断点续传：每写完一个分片在 `.partial.segs` 记一笔（见 resume.ts）。中途失败、取消或
 * 进程被杀都保留 .partial，下次调用校验已下分片后从断点继续；成品已存在（上次改名后、
 * 转封装前被打断）时直接返回。
 */
export async function downloadHls(
  net: NetClient,
  url: string,
  outBase: string,
  options: HlsOptions = {}
): Promise<HlsResult> {
  const headers: Record<string, string> = options.referer
    ? { Referer: options.referer }
    : {}
  const get = async (target: string, maxBytes: number): Promise<Buffer> => {
    const retries = options.retries ?? 3
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await net.request(target, {
          headers,
          maxBytes,
          timeoutMs: 60000,
          signal: options.signal,
        })
        if (res.status < 200 || res.status >= 300)
          throw new Error(`HTTP ${res.status}`)
        return Buffer.from(res.body)
      } catch (error) {
        if (options.signal?.aborted || attempt >= retries) throw error
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
      }
    }
  }
  const text = async (target: string): Promise<string> =>
    (await get(target, 4 * 1024 * 1024)).toString('utf-8')

  let playlistUrl = url
  let body = await text(url)
  if (isMasterPlaylist(body)) {
    playlistUrl = pickBestVariant(body, url)
    body = await text(playlistUrl)
  }
  const playlist = parseMediaPlaylist(body, playlistUrl)
  const container = playlist.map ? 'mp4' : 'ts'
  const file = `${outBase}.${container}`
  const partial = `${file}.partial`
  if (await isCompleteFile(file, partial)) return { file, container }

  const keys = new Map<string, Buffer>()
  const keyFor = async (k: SegmentKey): Promise<Buffer> => {
    let key = keys.get(k.uri)
    if (!key) {
      key = await get(k.uri, 1024)
      if (key.length !== 16) throw new Error('AES-128 密钥长度不对')
      keys.set(k.uri, key)
    }
    return key
  }
  const fetchSegment = async (segment: Segment): Promise<Buffer> => {
    const data = await get(segment.uri, 64 * 1024 * 1024)
    if (!segment.key) return data
    return decryptSegment(
      data,
      await keyFor(segment.key),
      segment.key.iv ?? sequenceIv(segment.sequence)
    )
  }

  // 写入单元：初始化段（有的话）排在最前，之后是各分片；续传按单元序号对齐
  const fetchers: Array<() => Promise<Buffer>> = playlist.segments.map(
    segment => () => fetchSegment(segment)
  )
  const uris = playlist.segments.map(s => s.uri)
  if (playlist.map) {
    const map = playlist.map
    fetchers.unshift(() => get(map, 16 * 1024 * 1024))
    uris.unshift(map)
  }
  const offset = playlist.map ? 1 : 0
  const total = playlist.segments.length
  const concurrency = Math.max(1, options.concurrency ?? 6)
  let writer: SegmentWriter | undefined
  try {
    writer = await openSegmentWriter(partial, playlistFingerprint(uris))
    let bytes = writer.bytes
    if (writer.start > offset)
      options.onProgress?.({ done: writer.start - offset, total, bytes })
    const inflight = new Map<number, Promise<Buffer>>()
    let next = writer.start
    for (let i = writer.start; i < fetchers.length; i++) {
      while (next < fetchers.length && next < i + concurrency) {
        const pending = fetchers[next]()
        pending.catch(() => {}) // 失败在按序 await 时抛出，这里只防未处理拒绝
        inflight.set(next, pending)
        next++
      }
      const data = await inflight.get(i)!
      inflight.delete(i)
      options.signal?.throwIfAborted()
      await writer.write(i, data)
      bytes += data.length
      if (i >= offset)
        options.onProgress?.({ done: i + 1 - offset, total, bytes })
    }
    await writer.close()
    writer = undefined
    await rename(partial, file)
    await rm(partial + SEGMENT_LOG_SUFFIX, { force: true })
    return { file, container }
  } finally {
    // 失败 / 取消：保留 .partial 与进度记录，下次续传；丢弃由任务移除负责
    await writer?.close()
  }
}

/** 成品已在、且没有未完成的 .partial：上次已下完（改名之后被打断）。 */
export async function isCompleteFile(
  file: string,
  partial: string
): Promise<boolean> {
  const exists = (p: string): Promise<boolean> =>
    access(p).then(
      () => true,
      () => false
    )
  return (await exists(file)) && !(await exists(partial))
}
