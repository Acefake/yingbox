/**
 * 缩略图模块入口：注册 thumb:// 协议与 thumbs 域。
 *
 * 缓存目录 userData/thumb-cache，上限 256 MB（LRU）。只给非影视的海报 / 封面用；
 * 生成在渲染层 Worker（createImageBitmap + OffscreenCanvas → WebP），主进程只落盘与代取原图。
 * 不用 nativeImage.createThumbnailFromPath（Linux 不支持，且只能读本地文件）。
 */
import { app, protocol } from 'electron'
import { join } from 'node:path'
import { thumbs } from '../../shared/contract/thumbs'
import { refererFor } from '../media-headers'
import { fetchHttp, readLimited } from '../http-client'
import { implement } from '../rpc'
import { ThumbCache } from './cache'
import { type Original, type ThumbService, createThumbService } from './service'

/** 原图大小上限 */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024

/** 非 http(s) 来源的取图函数，按协议登记（如 amane:） */
const loaders = new Map<string, (source: string) => Promise<Response>>()

/** 插件登记自己协议的原图读取（返回图片 Response） */
export function registerThumbSource(
  scheme: string,
  load: (source: string) => Promise<Response>
): void {
  loaders.set(scheme, load)
}

async function toOriginal(response: Response): Promise<Original> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get('content-type')?.split(';')[0] || ''
  if (!type.startsWith('image/')) {
    await response.body?.cancel().catch(() => {})
    throw new Error('响应不是图片')
  }
  if (
    Number(response.headers.get('content-length') || 0) > MAX_ORIGINAL_BYTES
  ) {
    await response.body?.cancel().catch(() => {})
    throw new Error('图片超过大小上限')
  }
  return { data: await readLimited(response, MAX_ORIGINAL_BYTES), type }
}

async function loadOriginal(source: string): Promise<Original> {
  const scheme = new URL(source).protocol
  const loader = loaders.get(scheme)
  if (loader) return toOriginal(await loader(source))
  const response = await fetchHttp(
    source,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        // 与 <img referrerpolicy="no-referrer"> 一致：只给名单里的防盗链 CDN 带 Referer
        ...(refererFor(source) ? { Referer: refererFor(source)! } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    },
    15000
  )
  return toOriginal(response)
}

let service: ThumbService | null = null

/** app ready 之后调用 */
export function registerThumbnails(): void {
  service = createThumbService({
    cache: new ThumbCache(join(app.getPath('userData'), 'thumb-cache')),
    loadOriginal,
  })
  const current = service
  protocol.handle('thumb', request => current.respond(request.url))
  implement(thumbs, {
    put: (_, source, width, data) => current.put(source, width, data),
  })
}
