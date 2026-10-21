/**
 * 海报 / 封面缩略图：<img> 用 thumbSrc() 拿 yingbox-media://thumb/ 地址，主进程取原图、
 * 生成 WebP、落盘后返回（流程见 src/shared/media-url.ts 与 src/main/thumbnails）。
 *
 * Web/PWA（没有主进程）或来源不支持时原样返回原图地址。
 */
import {
  type ThumbWidth,
  pickThumbWidth,
  thumbUrl,
} from '../../../../shared/media-url'

export { pickThumbWidth }

/** <img> 的地址：桌面端走缩略图协议，否则原图 */
export function thumbSrc(source: string, width: ThumbWidth): string {
  const desktop = typeof window !== 'undefined' && !!window.api
  return (desktop && thumbUrl(source, width)) || source
}
