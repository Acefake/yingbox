/**
 * 主进程自己的出网口（字幕搜索、缩略图原图）：复用 src/shared/net 的同一套实现（SSRF 防护），
 * 底层用 Node fetch。在线、AV、下载走引擎（Electron net），不经这里。
 */
import { lookup } from 'node:dns/promises'
import { createNetClient, readBody } from '../shared/net/client'

const net = createNetClient({
  fetch: (url, init) => fetch(url, init),
  lookup: host => lookup(host, { all: true }),
})

/**
 * 带 SSRF 防护的请求：初始目标与每一跳重定向都过内网检查，非 2xx 抛错。
 * 返回未读的响应，调用方负责读完。
 */
export async function fetchHttp(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const { response } = await net.open(url, {
    method: (options.method?.toUpperCase() ?? 'GET') as 'GET',
    headers: options.headers as Record<string, string> | undefined,
    body: options.body as string | undefined,
    timeoutMs,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response
}

/** 读完响应体（默认上限 16MB）。 */
export async function readLimited(
  response: Response,
  maxBytes = 16 * 1024 * 1024
): Promise<Buffer> {
  return Buffer.from(await readBody(response, maxBytes))
}
