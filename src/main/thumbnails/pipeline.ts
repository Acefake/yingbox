/**
 * 缩略图管线的组装（宿主无关）：缓存目录 + 缩放器 + WebP 编码线程 + 原图来源 → 协议处理函数与预热。
 *
 * 桌面端（index.ts）把 handle 注册成 yingbox-media:// 协议，缩放器用 nativeImage；
 * 独立服务（src/server）把 /media/... 请求改写成 yingbox-media:// 地址交给同一个 handle，缩放器用 wasm。
 * 一个缓存目录 <mediaDir>/thumb、一个 LRU 上限（cache.ts），两种宿主的磁盘布局完全相同。
 */
import { join } from 'node:path'
import { refererFor } from '../../shared/net/media-referer'
import { fetchHttp, readLimited } from '../http-client'
import { ThumbCache, exists } from './cache'
import type { Codec } from './codec-client'
import { originalPath } from './paths'
import { createMediaHandler } from './protocol'
import { createSourceLoader } from './sources'
import {
  type ImageResizer,
  type ThumbEncoder,
  Thumbnailer,
} from './thumbnailer'

/** 组装参数。 */
export interface ThumbnailPipelineOptions {
  /** 媒体库图片目录（orig/ 原图、thumb/ 缩略图）。 */
  mediaDir: string
  /** 编解码线程；undefined 时不编 WebP（退回 JPEG）。 */
  codec: Codec | undefined
  /** 宿主的缩放实现。 */
  resizer: ImageResizer
  log: (message: string) => void
}

/** 组装好的管线。 */
export interface ThumbnailPipeline {
  /** 处理一个 yingbox-media:// 请求（地址形态见 shared/media-url.ts）。 */
  handle(request: Request): Promise<Response>
  /** 媒体库下载好一批原图后调用，后台生成全部宽度的缩略图。 */
  warm(keys: string[]): void
}

/** 带防盗链 Referer 与 SSRF 防护的原图下载（与 <img referrerpolicy="no-referrer"> 一致，只给名单里的 CDN 带 Referer）。 */
function fetchImage(source: string): Promise<Response> {
  const referer = refererFor(source)
  return fetchHttp(
    source,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        ...(referer ? { Referer: referer } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    },
    15000
  )
}

/** 组装缩略图管线。 */
export function createThumbnailPipeline(
  options: ThumbnailPipelineOptions
): ThumbnailPipeline {
  const { codec, mediaDir, log } = options
  const encode: ThumbEncoder | undefined = codec
    ? async (rgba, width, height, quality) =>
        (
          await codec({ op: 'encode', rgba, width, height, quality }, [
            rgba.buffer as ArrayBuffer,
          ])
        ).data
    : undefined
  const thumbnailer = new Thumbnailer(
    new ThumbCache(join(mediaDir, 'thumb')),
    options.resizer,
    encode,
    log
  )
  const loadSource = createSourceLoader({
    readLimited,
    fetchImage,
  })
  return {
    handle: createMediaHandler({ mediaDir, thumbnailer, loadSource }),
    warm: keys =>
      thumbnailer.warm(
        keys.map(key => ({
          key,
          load: async () => {
            const path = originalPath(mediaDir, key)
            return (await exists(path)) ? { path } : null
          },
        }))
      ),
  }
}
