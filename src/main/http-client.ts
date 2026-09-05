import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { replaceFile, withPathLocks } from './file-operations'

export async function fetchHttp(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 HTTP/HTTPS 地址')
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response
}

export async function readLimited(response: Response, maxBytes = 16 * 1024 * 1024): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('响应内容超过大小限制')
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function downloadFile(url: string, filePath: string): Promise<void> {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${randomUUID()}.partial`
    try {
      const response = await fetchHttp(url, {}, 60000)
      if (!response.body) throw new Error('下载响应为空')
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        createWriteStream(temporary, { flags: 'wx' }),
      )
      await replaceFile(temporary, filePath)
    } finally { await unlink(temporary).catch(() => {}) }
  })
}
