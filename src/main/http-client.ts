/**
 * 主进程 http 域（影视刮削、字幕在用）的出网口：复用 src/shared/net 的同一套实现，
 * 底层用 Node fetch。在线、AV、下载走引擎（Electron net），不经这里。
 */
import { lookup } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createNetClient, readBody } from '../shared/net/client'
import { replaceFile, withPathLocks } from './file-operations'

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

/** 下载到本地文件：先写临时文件再原子替换。 */
export async function downloadFile(
  url: string,
  filePath: string
): Promise<void> {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${randomUUID()}.partial`
    try {
      const response = await fetchHttp(url, {}, 60000)
      if (!response.body) throw new Error('下载响应为空')
      await pipeline(
        Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream<Uint8Array>
        ),
        createWriteStream(temporary, { flags: 'wx' })
      )
      await replaceFile(temporary, filePath)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  })
}
