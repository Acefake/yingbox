/**
 * 托管网页端（vite build:web 的产物 dist-web）：NAS 上只需打开一个地址，网页与 API 同源。
 *
 * - assets/ 下带哈希的文件一年强缓存，其余（index.html、图标）每次协商；
 * - 未知路径回 index.html（路由是 hash 模式，主要兜底 PWA 启动地址）；
 * - 路径先规范化再确认仍在 webDir 内，挡住 ../ 穿越。
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'

/** Response 构造参数里的 body 类型（服务端 tsconfig 没有 DOM 的 BodyInit）。 */
type ResponseBody = ConstructorParameters<typeof Response>[0]

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/** webDir 内的文件路径；穿越或不合法返回 null。 */
export function resolveStatic(webDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const target = normalize(join(webDir, decoded))
  const rel = relative(webDir, target)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return null
  return target
}

async function fileResponse(
  path: string,
  request: Request,
  immutable: boolean
): Promise<Response | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
    const headers = {
      'Content-Type':
        TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      ETag: etag,
    }
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers })
    const body = request.method === 'HEAD' ? null : await readFile(path)
    return new Response(body as ResponseBody, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(info.size) },
    })
  } catch {
    return null
  }
}

/** 创建静态文件处理函数；找不到时回 index.html。 */
export function createStaticHandler(
  webDir: string
): (request: Request, url: URL) => Promise<Response> {
  return async (request, url) => {
    const path = resolveStatic(webDir, url.pathname)
    if (path && url.pathname !== '/') {
      const hit = await fileResponse(
        path,
        request,
        url.pathname.startsWith('/assets/')
      )
      if (hit) return hit
    }
    return (
      (await fileResponse(join(webDir, 'index.html'), request, false)) ??
      new Response('Not Found', { status: 404 })
    )
  }
}
