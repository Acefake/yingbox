/**
 * 直播线路探测：经与播放代理相同的出网口（SSRF 校验、逐跳重定向、带 Referer）发一个 GET，
 * 只读开头几 KB 判断格式，然后断开——直播流是不会结束的响应体，不能读完。
 *
 * 失败时给出具体原因（连接超时 / HTTP 状态码 / 内网地址被拦 / 网络错误），渲染层据此提示与换线。
 */
import { refererFor } from '../../shared/net/media-referer'
import {
  splitStreamHeaders,
  toRequestHeaders,
} from '../../shared/net/stream-headers'
import type { NetClient } from '../../shared/net/client'
import { BlockedTargetError } from '../../shared/net/guard'
import {
  detectStreamKind,
  isExternalOnlyUrl,
  kindFromUrl,
} from '../../shared/iptv/stream-kind'
import type { StreamProbe } from '../../shared/contract/iptv'

/** 等响应头的上限（含所有重定向） */
export const PROBE_CONNECT_MS = 10_000
/** 拿到响应头后读开头字节的上限 */
export const PROBE_READ_MS = 5_000
/** 读多少字节就够判断格式 */
export const PROBE_HEAD_BYTES = 4096

/** 探测依赖（测试注入时间上限） */
export interface ProbeOptions {
  connectMs?: number
  readMs?: number
}

/** 读响应体开头最多 limit 字节，超时就用已读到的部分；读完立即取消上游 */
async function readHead(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  ms: number
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    while (size < limit) {
      const next = await Promise.race([reader.read(), timeout])
      if (next === 'timeout' || next.done) break
      chunks.push(next.value)
      size += next.value.byteLength
    }
  } catch {
    // 读到一半断开：用已读到的部分判断
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(Math.min(size, limit))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset)
    out.set(part, offset)
    offset += part.length
    if (offset >= out.length) break
  }
  return out
}

/**
 * 探测一条直播线路。
 * @param net 出网客户端（主进程与播放代理同一个）
 * @param line 线路地址；可带 `|User-Agent=…&Referer=…`（线路自带的请求头，见 net/stream-headers）
 */
export async function probeStream(
  net: NetClient,
  line: string,
  options: ProbeOptions = {}
): Promise<StreamProbe> {
  const { url, headers: lineHeaders } = splitStreamHeaders(line)
  if (isExternalOnlyUrl(url))
    return { ok: true, kind: kindFromUrl(url) ?? 'mpegts', finalUrl: url }
  const connectMs = options.connectMs ?? PROBE_CONNECT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), connectMs)
  const headers: Record<string, string> = {}
  const referer = refererFor(url)
  if (referer) headers.Referer = referer
  Object.assign(headers, toRequestHeaders(lineHeaders))
  try {
    const { response, url: finalUrl } = await net.open(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      // 总时长由上面的连接计时与 readHead 的读取计时控制
      timeoutMs: connectMs + (options.readMs ?? PROBE_READ_MS) + 1000,
    })
    clearTimeout(timer)
    const contentType = response.headers.get('content-type') ?? ''
    if (response.status >= 400) {
      void response.body?.cancel().catch(() => {})
      return {
        ok: false,
        failure: 'http',
        status: response.status,
        finalUrl,
        contentType,
        error: `HTTP ${response.status}`,
      }
    }
    const head = await readHead(
      response.body,
      PROBE_HEAD_BYTES,
      options.readMs ?? PROBE_READ_MS
    )
    return {
      ok: true,
      kind: detectStreamKind({ head, contentType, url: finalUrl }),
      status: response.status,
      finalUrl,
      contentType,
    }
  } catch (error) {
    clearTimeout(timer)
    if (controller.signal.aborted || (error as Error).name === 'TimeoutError')
      return { ok: false, failure: 'timeout', error: '连接超时' }
    if (error instanceof BlockedTargetError)
      return { ok: false, failure: 'blocked', error: error.message }
    return {
      ok: false,
      failure: 'network',
      error: (error as Error).message || String(error),
    }
  }
}
