/**
 * 托管网页端（vite build:web 的产物 dist-web）：NAS 上只需打开一个地址，网页与 API 同源。
 *
 * - assets/ 下带哈希的文件一年强缓存，其余（index.html、图标）每次协商；
 * - 构建时写下的 .br / .gz 按 Accept-Encoding 直接发，带 Content-Encoding 与 Vary；
 * - 客户端不接受或没有预压缩文件时回原文；
 * - 大文件用流，不整份读进内存；
 * - 未知路径回 index.html（路由是 hash 模式，主要兜底 PWA 启动地址）；
 * - 路径先规范化再确认仍在 webDir 内，挡住 ../ 穿越。
 */
import type { Stats } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { Readable } from 'node:stream'

/** Response 构造参数里的 body 类型（服务端 tsconfig 没有 DOM 的 BodyInit）。 */
type ResponseBody = ConstructorParameters<typeof Response>[0]

/** 达到这个字节数就流式读，避免把播放器包一类的大文件整份放进内存。 */
export const STATIC_STREAM_ABOVE = 128 * 1024

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

const ENCODINGS = [
  { coding: 'br', suffix: '.br' },
  { coding: 'gzip', suffix: '.gz' },
] as const

type Coding = (typeof ENCODINGS)[number]['coding']

interface ChosenFile {
  path: string
  encoding: Coding | null
  info: Stats
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

/** Accept-Encoding 里某个编码的 q；没写这个头时不主动压缩。 */
function encodingQuality(header: string | null, coding: string): number {
  if (header == null || header.trim() === '') return 0
  const scores = new Map<string, number>()
  for (const part of header.split(',')) {
    const [nameRaw, ...params] = part.split(';')
    const name = nameRaw.trim().toLowerCase()
    if (!name) continue
    let q = 1
    for (const param of params) {
      const [key, value] = param.split('=').map(item => item.trim())
      if (key !== 'q') continue
      const parsed = Number(value)
      q = Number.isFinite(parsed) ? parsed : 0
    }
    scores.set(name, q)
  }
  if (scores.has(coding)) return scores.get(coding) ?? 0
  if (scores.has('*')) return scores.get('*') ?? 0
  return 0
}

/** 客户端能接受、磁盘上也有的预压缩文件；否则原文。 */
async function chooseFile(
  path: string,
  raw: Stats,
  accept: string | null
): Promise<ChosenFile> {
  const ranked = ENCODINGS.map(item => ({
    ...item,
    q: encodingQuality(accept, item.coding),
  }))
    .filter(item => item.q > 0)
    .sort((a, b) => b.q - a.q || (a.coding === 'br' ? -1 : 1))
  for (const item of ranked) {
    try {
      const info = await stat(path + item.suffix)
      if (info.isFile())
        return { path: path + item.suffix, encoding: item.coding, info }
    } catch {
      // 这份预压缩不在，试下一个或回原文
    }
  }
  return { path, encoding: null, info: raw }
}

function etagOf(info: Stats): string {
  return `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
}

/**
 * 大文件先打开句柄再交给流。打不开（已删、无权限）时抛出，
 * 响应尚未发出，调用方回 index.html。发出之后的读取错误只能拆掉连接。
 */
async function openBody(path: string, size: number): Promise<ResponseBody> {
  if (size < STATIC_STREAM_ABOVE) return await readFile(path)
  const handle = await open(path, 'r')
  try {
    return Readable.toWeb(handle.createReadStream()) as ResponseBody
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function fileResponse(
  path: string,
  request: Request,
  immutable: boolean
): Promise<Response | null> {
  try {
    const raw = await stat(path)
    if (!raw.isFile()) return null
    const chosen = await chooseFile(
      path,
      raw,
      request.headers.get('accept-encoding')
    )
    const etag = etagOf(chosen.info)
    const headers: Record<string, string> = {
      'Content-Type':
        TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding',
    }
    if (chosen.encoding) headers['Content-Encoding'] = chosen.encoding
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers })
    const body =
      request.method === 'HEAD'
        ? null
        : await openBody(chosen.path, chosen.info.size)
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(chosen.info.size) },
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
