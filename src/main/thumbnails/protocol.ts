/**
 * yingbox-media:// 协议处理（不依赖 Electron，便于单测），地址形态见 src/shared/media-url.ts：
 *   image/<key>?w=…  → 媒体库原图的缩略图（必要时现生成）；
 *   image/<key>      → 媒体库原图；
 *   thumb/?w=…&src=… → 任意来源的缩略图（取原图、生成、落盘）。
 * 内容按 key / 来源不可变，响应带一年 immutable 强缓存；ETag 用 key + 宽度。
 */
import { readFile } from 'node:fs/promises'
import { exists } from './cache'
import { parseMediaUrl } from '../../shared/media-url'
import { imageKey, originalPath } from './paths'
import type { OriginalImage, ThumbFile, Thumbnailer } from './thumbnailer'

/** Response 构造参数里的 body 类型（主进程 tsconfig 没有 DOM 的 BodyInit）。 */
type Body = ConstructorParameters<typeof Response>[0]

/** 强缓存头。 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** 协议处理的依赖。 */
export interface MediaHandlerDeps {
  /** 媒体库图片目录（orig/ 下是引擎下载的原图）。 */
  mediaDir: string
  thumbnailer: Thumbnailer
  /** 取任意来源的原图；取不到抛错。 */
  loadSource(source: string): Promise<OriginalImage>
}

/** 按文件头判断原图类型。 */
function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

const status = (code: number, text: string): Response =>
  new Response(text, { status: code })

/** 创建协议处理函数。 */
export function createMediaHandler(
  deps: MediaHandlerDeps
): (request: Request) => Promise<Response> {
  /** 媒体库原图（不存在返回 null）。 */
  const libraryOriginal = async (
    key: string
  ): Promise<OriginalImage | null> => {
    const path = originalPath(deps.mediaDir, key)
    return (await exists(path)) ? { path } : null
  }

  return async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return status(405, 'Method Not Allowed')
    }
    const target = parseMediaUrl(request.url)
    if (!target) return status(404, 'Not Found')
    const key = target.kind === 'image' ? target.key : imageKey(target.source)
    const etag = `"${key}-${target.width ?? 'o'}"`
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL },
      })
    }
    let body: Uint8Array
    let type: string
    try {
      if (target.width === undefined) {
        body = await readFile(originalPath(deps.mediaDir, key))
        type = sniff(body)
      } else {
        let thumb: ThumbFile | null
        if (target.kind === 'image') {
          thumb = await deps.thumbnailer.ensure(key, target.width, () =>
            libraryOriginal(key)
          )
        } else {
          const { source } = target
          // 同一个远程地址媒体库已经下载过原图时直接用（key 算法相同）
          thumb = await deps.thumbnailer.ensure(
            key,
            target.width,
            async () => (await libraryOriginal(key)) ?? deps.loadSource(source)
          )
        }
        if (!thumb) return status(404, 'Not Found')
        body = await readFile(thumb.path)
        type = thumb.contentType
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return status(404, 'Not Found')
      }
      // 远程原图取不到 / 解不了：<img> 收到错误后退回原图地址
      return status(502, 'Bad Gateway')
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
  }
}
