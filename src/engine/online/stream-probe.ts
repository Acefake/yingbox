/**
 * 播放源测速（详情页自动选源用）：对一集的直链测首包延迟和约 2 秒的下载速度。
 *
 * - m3u8：取清单（主清单选码率最高的子清单，顺带读分辨率）→ 首个分片下载 sampleMs 毫秒；
 * - mp4 / flv 等直链：直接下载 sampleMs 毫秒；
 * - 延迟 = 第一个请求从发出到收到响应头的毫秒数。
 * 请求都经 shared/net（SSRF 防护），防盗链 CDN 按 media-referer 名单带 Referer。
 * 失败不抛错，返回 ok: false 与原因。
 */
import type { NetClient } from '../../shared/net/client'
import { refererFor } from '../../shared/net/media-referer'
import type { StreamProbe } from '../../shared/contract/online'

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

/** 主清单里的一个子清单。 */
export interface HlsVariant {
  uri: string
  bandwidth: number
  height?: number
}

/** 解析 m3u8：主清单返回 variants，媒体清单返回首个分片地址（都是原始写法，未补全）。 */
export function parseM3u8(text: string): {
  variants: HlsVariant[]
  firstSegment?: string
} {
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const variants: HlsVariant[] = []
  let firstSegment: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
  return variants.length ? { variants } : { variants, firstSegment }
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

/** 读文本（上限 PLAYLIST_MAX_BYTES，超出截断）。 */
async function readText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < PLAYLIST_MAX_BYTES) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : concat(chunks, size)
  )
}

const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 读 body 至多 sampleMs 毫秒，返回字节数与实际耗时（毫秒）。 */
async function sample(
  response: Response,
  sampleMs: number,
  now: () => number
): Promise<{ bytes: number; elapsed: number }> {
  const start = now()
  let bytes = 0
  if (!response.body) return { bytes, elapsed: 0 }
  const reader = response.body.getReader()
  const timer = setTimeout(() => {
    void reader.cancel().catch(() => {})
  }, sampleMs)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (now() - start >= sampleMs) break
    }
  } catch {
    // 采样到时被取消：按已读字节算
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
  }
  return { bytes, elapsed: Math.max(1, now() - start) }
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

  let latencyMs: number | undefined
  try {
    const started = now()
    let { response, url: finalUrl } = await open(url)
    latencyMs = Math.max(0, Math.round(now() - started))
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return fail(`HTTP ${response.status}`, latencyMs)
    }
    let height: number | undefined
    const contentType = response.headers.get('content-type') || ''
    if (looksLikeM3u8(finalUrl, contentType)) {
      let segment: string | undefined
      for (let depth = 0; depth <= MAX_NESTED && !segment; depth++) {
        const parsed = parseM3u8(await readText(response))
        if (parsed.firstSegment) {
          segment = new URL(parsed.firstSegment, finalUrl).href
          break
        }
        const variant = pickVariant(parsed.variants)
        if (!variant || depth === MAX_NESTED)
          return fail('清单里没有分片', latencyMs)
        height = height ?? variant.height
        ;({ response, url: finalUrl } = await open(
          new URL(variant.uri, finalUrl).href
        ))
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          return fail(`HTTP ${response.status}`, latencyMs)
        }
      }
      if (!segment) return fail('清单里没有分片', latencyMs)
      ;({ response } = await open(segment))
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return fail(`分片 HTTP ${response.status}`, latencyMs)
      }
    }
    const { bytes, elapsed } = await sample(response, sampleMs, now)
    if (!bytes) return fail('没有下载到数据', latencyMs)
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
