/**
 * 播放源测速（详情页自动选源用）：对一集的直链测首包延迟和约 2 秒的下载速度。
 *
 * - m3u8：取清单（主清单选码率最高的子清单，顺带读分辨率）→ 首个分片下载 sampleMs 毫秒；
 * - mp4 / flv 等直链：直接下载 sampleMs 毫秒；
 * - 延迟 = 第一个请求从发出到收到响应头的毫秒数；
 * - 只有确认是媒体（media-sniff：Content-Type + 首字节）才算成功，HTTP 200 的网页 / JSON 返回 ok: false；
 * - 加密 HLS（hls-key）：AES-128 拉密钥解密首分片开头再嗅探；SAMPLE-AES 或密钥拿不到时无法校验魔数，
 *   只排除明显的 HTML / JSON 错误页（Content-Type 与开头文本）。
 * 请求都经 shared/net（SSRF 防护），防盗链 CDN 按 media-referer 名单带 Referer。
 * 失败不抛错，返回 ok: false 与原因。
 */
import type { NetClient } from '../../shared/net/client'
import { refererFor } from '../../shared/net/media-referer'
import type { StreamProbe } from '../../shared/contract/online'
import {
  type HlsKey,
  decryptHead,
  keyIv,
  looksLikeErrorPage,
  parseKeyTag,
} from './hls-key'
import { SNIFF_BYTES, isNonMediaType, mediaError } from './media-sniff'

/** 测速参数。 */
export interface ProbeOptions {
  /** 分片下载采样时长（毫秒），默认 2000 */
  sampleMs?: number
  /** 单个请求等响应头的超时（毫秒），默认 8000 */
  timeoutMs?: number
  /** 当前时间（测试注入） */
  now?: () => number
}

/** 清单文本上限：1MB */
const PLAYLIST_MAX_BYTES = 1024 * 1024
/** 主清单 → 子清单最多跟几层 */
const MAX_NESTED = 2
/** 密钥响应读取上限（AES-128 密钥是 16 字节） */
const KEY_MAX_BYTES = 64

/** 主清单里的一个子清单。 */
export interface HlsVariant {
  uri: string
  bandwidth: number
  height?: number
}

/** parseM3u8 的结果。 */
export interface ParsedM3u8 {
  variants: HlsVariant[]
  firstSegment?: string
  /** 首个分片的媒体序号（EXT-X-MEDIA-SEQUENCE，缺省 0），算默认 IV 用 */
  sequence?: number
  /** 首个分片生效的加密信息 */
  key?: HlsKey
}

/**
 * 解析 m3u8：主清单返回 variants；媒体清单返回首个分片地址、媒体序号和它生效的 EXT-X-KEY
 * （地址都是原始写法，未补全）。
 */
export function parseM3u8(text: string): ParsedM3u8 {
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const variants: HlsVariant[] = []
  let firstSegment: string | undefined
  let sequence = 0
  let key: HlsKey | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!firstSegment && line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))
      sequence = Number(line.split(':')[1]) || 0
    if (!firstSegment && line.startsWith('#EXT-X-KEY:')) key = parseKeyTag(line)
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const uri = lines.slice(i + 1).find(next => next && !next.startsWith('#'))
      if (!uri) continue
      const bandwidth = Number(/BANDWIDTH=(\d+)/i.exec(line)?.[1] || 0)
      const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(line)?.[1] || 0)
      variants.push({ uri, bandwidth, ...(height ? { height } : {}) })
      continue
    }
    if (!firstSegment && line && !line.startsWith('#')) {
      // 紧跟在 STREAM-INF 之后的那一行是子清单，上面已处理
      const prev = lines[i - 1] || ''
      if (!prev.startsWith('#EXT-X-STREAM-INF')) firstSegment = line
    }
  }
  if (variants.length) return { variants }
  return { variants, firstSegment, sequence, ...(key ? { key } : {}) }
}

/** 主清单里选码率最高（同码率取分辨率高）的子清单。 */
export function pickVariant(variants: HlsVariant[]): HlsVariant | undefined {
  return [...variants].sort(
    (a, b) => b.bandwidth - a.bandwidth || (b.height || 0) - (a.height || 0)
  )[0]
}

const looksLikeM3u8 = (url: string, contentType: string): boolean =>
  /\.m3u8(\?|#|$)/i.test(url) || /mpegurl/i.test(contentType)

const headersFor = (url: string): Record<string, string> => {
  const referer = refererFor(url)
  return referer ? { Referer: referer } : {}
}

/** 读正文至多约 maxBytes 字节（超出截断）。 */
async function readBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < maxBytes) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return chunks.length === 1 ? chunks[0] : concat(chunks, size)
}

/** 读清单文本（上限 PLAYLIST_MAX_BYTES）。 */
const readText = async (response: Response): Promise<string> =>
  new TextDecoder().decode(await readBytes(response, PLAYLIST_MAX_BYTES))

const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 读 body 至多 sampleMs 毫秒，返回字节数、实际耗时（毫秒）与正文首部（嗅探用）。 */
async function sample(
  response: Response,
  sampleMs: number,
  now: () => number
): Promise<{ bytes: number; elapsed: number; head: Uint8Array }> {
  const start = now()
  let bytes = 0
  const head = new Uint8Array(SNIFF_BYTES)
  if (!response.body) return { bytes, elapsed: 0, head: head.subarray(0, 0) }
  const reader = response.body.getReader()
  const timer = setTimeout(() => {
    void reader.cancel().catch(() => {})
  }, sampleMs)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (bytes < SNIFF_BYTES)
        head.set(value.subarray(0, SNIFF_BYTES - bytes), bytes)
      bytes += value.byteLength
      if (now() - start >= sampleMs) break
    }
  } catch {
    // 采样到时被取消：按已读字节算
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
  }
  return {
    bytes,
    elapsed: Math.max(1, now() - start),
    head: head.subarray(0, Math.min(bytes, SNIFF_BYTES)),
  }
}

/** 响应不能用（HTTP 错误 / 明确不是媒体的 Content-Type）时的原因，并丢弃正文。 */
async function rejectReason(
  response: Response,
  prefix = ''
): Promise<string | undefined> {
  const type = response.headers.get('content-type') || ''
  const reason = !response.ok
    ? `${prefix}HTTP ${response.status}`
    : isNonMediaType(type)
      ? mediaError(type, new Uint8Array())
      : undefined
  if (reason) await response.body?.cancel().catch(() => {})
  return reason
}

/** 首个分片的加密信息（密钥地址已补全）。 */
interface SegmentCipher {
  method: string
  keyUrl?: string
  iv: Uint8Array
}

const cipherOf = (
  parsed: ParsedM3u8,
  base: string
): SegmentCipher | undefined => {
  const { key } = parsed
  if (!key) return undefined
  let keyUrl: string | undefined
  try {
    keyUrl = key.uri ? new URL(key.uri, base).href : undefined
  } catch {
    keyUrl = undefined
  }
  return { method: key.method, keyUrl, iv: keyIv(key, parsed.sequence ?? 0) }
}

/**
 * 加密分片的校验：先排除文本错误页；AES-128 拿到 16 字节密钥时解密开头再嗅探魔数，
 * 拿不到密钥或 SAMPLE-AES 等无法解密时不要求魔数。
 */
async function encryptedError(
  contentType: string,
  head: Uint8Array,
  cipher: SegmentCipher,
  fetchKey: (url: string) => Promise<Uint8Array | undefined>
): Promise<string | undefined> {
  if (looksLikeErrorPage(head)) return '分片是错误页面'
  if (cipher.method !== 'AES-128' || !cipher.keyUrl) return undefined
  const key = await fetchKey(cipher.keyUrl)
  const plain = key && decryptHead(head, key, cipher.iv)
  return plain ? mediaError(contentType, plain) : undefined
}

const fail = (error: string, latencyMs?: number): StreamProbe => ({
  ok: false,
  error,
  ...(latencyMs !== undefined ? { latencyMs } : {}),
})

/** 测一个播放直链；url 应是已解析好的 m3u8 / mp4 地址。 */
export async function probeStream(
  net: NetClient,
  url: string,
  options: ProbeOptions = {}
): Promise<StreamProbe> {
  const sampleMs = options.sampleMs ?? 2000
  const timeoutMs = options.timeoutMs ?? 8000
  const now = options.now ?? Date.now
  const open = (target: string): ReturnType<NetClient['open']> =>
    net.open(target, { headers: headersFor(target), timeoutMs })
  /** 拉 AES-128 密钥（同样走 SSRF 防护）；失败或不是 16 字节返回 undefined。 */
  const fetchKey = async (target: string): Promise<Uint8Array | undefined> => {
    try {
      const { response } = await open(target)
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return undefined
      }
      const key = await readBytes(response, KEY_MAX_BYTES)
      return key.byteLength === 16 ? key : undefined
    } catch {
      return undefined
    }
  }

  let latencyMs: number | undefined
  try {
    const started = now()
    let { response, url: finalUrl } = await open(url)
    latencyMs = Math.max(0, Math.round(now() - started))
    const rejected = await rejectReason(response)
    if (rejected) return fail(rejected, latencyMs)
    let height: number | undefined
    let cipher: SegmentCipher | undefined
    const contentType = response.headers.get('content-type') || ''
    if (looksLikeM3u8(finalUrl, contentType)) {
      let segment: string | undefined
      for (let depth = 0; depth <= MAX_NESTED && !segment; depth++) {
        const parsed = parseM3u8(await readText(response))
        if (parsed.firstSegment) {
          segment = new URL(parsed.firstSegment, finalUrl).href
          cipher = cipherOf(parsed, finalUrl)
          break
        }
        const variant = pickVariant(parsed.variants)
        if (!variant || depth === MAX_NESTED)
          return fail('清单里没有分片', latencyMs)
        height = height ?? variant.height
        ;({ response, url: finalUrl } = await open(
          new URL(variant.uri, finalUrl).href
        ))
        const nested = await rejectReason(response)
        if (nested) return fail(nested, latencyMs)
      }
      if (!segment) return fail('清单里没有分片', latencyMs)
      ;({ response } = await open(segment))
      const bad = await rejectReason(response, '分片 ')
      if (bad) return fail(bad, latencyMs)
    }
    const { bytes, elapsed, head } = await sample(response, sampleMs, now)
    if (!bytes) return fail('没有下载到数据', latencyMs)
    const type = response.headers.get('content-type') || ''
    const notMedia = cipher
      ? await encryptedError(type, head, cipher, fetchKey)
      : mediaError(type, head)
    if (notMedia) return fail(notMedia, latencyMs)
    return {
      ok: true,
      latencyMs,
      speedBps: Math.round((bytes * 1000) / elapsed),
      ...(height ? { height } : {}),
    }
  } catch (error) {
    return fail((error as Error)?.message || '请求失败', latencyMs)
  }
}
