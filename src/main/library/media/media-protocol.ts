/**
 * yingbox-media:// 协议处理（不依赖 Electron，便于单测）：
 *   yingbox-media://image/<key>?w=300|780 → 缩略图（WebP，必要时现生成）；
 *   yingbox-media://image/<key>          → 原图。
 * key 是远程 URL 的哈希、内容不可变，响应带一年 immutable 强缓存；ETag 用 key + 宽度。
 */
import { readFile } from 'node:fs/promises'
import { parseMediaImageUrl } from '../../../shared/library/media-url'
import { type Thumbnailer, originalFile } from './thumbnailer'

/** Response 构造参数里的 body 类型（主进程 tsconfig 没有 DOM 的 BodyInit）。 */
type Body = ConstructorParameters<typeof Response>[0]

/** 强缓存头。 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** 按文件头判断原图类型。 */
function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

const notFound = (): Response => new Response('Not Found', { status: 404 })

/** 创建协议处理函数。 */
export function createMediaHandler(
  mediaDir: string,
  thumbnailer: Thumbnailer
): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const target = parseMediaImageUrl(request.url)
    if (!target) return notFound()
    const etag = `"${target.key}-${target.width ?? 'o'}"`
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL },
      })
    }
    try {
      let body: Uint8Array
      let type: string
      if (target.width) {
        const thumb = await thumbnailer.ensure(target.key, target.width)
        if (!thumb) return notFound()
        body = await readFile(thumb.path)
        type = thumb.contentType
      } else {
        body = await readFile(originalFile(mediaDir, target.key))
        type = sniff(body)
      }
      return new Response(request.method === 'HEAD' ? null : (body as Body), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(body.byteLength),
          'Cache-Control': CACHE_CONTROL,
          ETag: etag,
        },
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notFound()
      return new Response('Internal Error', { status: 500 })
    }
  }
}
