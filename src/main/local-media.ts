import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const mimeTypes: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
}

export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end } : null
}

export async function serveLocalMedia(request: Request): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  let filePath: string
  try {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    if (url.host && !/^[a-z]$/i.test(url.host)) return new Response(null, { status: 400 })
    filePath = url.host ? `${url.host.toUpperCase()}:${pathname}` : pathname.replace(/^\/(?=\/)/, '')
  } catch { return new Response(null, { status: 400 }) }

  try {
    const handle = await open(filePath, 'r')
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) { await handle.close(); return new Response(null, { status: 404 }) }
      const headers = new Headers({
        'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
        'Last-Modified': stats.mtime.toUTCString(),
      })
      const requested = request.headers.get('Range')
      const range = requested ? parseRange(requested, stats.size) : null
      if (requested && !range) {
        await handle.close()
        headers.set('Content-Range', `bytes */${stats.size}`)
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Length', String(range ? range.end - range.start + 1 : stats.size))
      if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`)
      if (request.method === 'HEAD' || stats.size === 0) {
        await handle.close()
        return new Response(null, { status: range ? 206 : 200, headers })
      }
      const stream = handle.createReadStream(range ?? {})
      const abort = () => stream.destroy()
      request.signal.addEventListener('abort', abort, { once: true })
      stream.once('close', () => request.signal.removeEventListener('abort', abort))
      if (request.signal.aborted) abort()
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: range ? 206 : 200, headers,
      })
    } catch (error) { await handle.close().catch(() => {}); throw error }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return new Response(null, { status: code === 'ENOENT' ? 404 : code === 'EACCES' ? 403 : 500 })
  }
}
