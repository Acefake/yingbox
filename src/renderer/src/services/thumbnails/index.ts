/**
 * 海报 / 封面缩略图：<img> 用 thumbSrc() 拿 yingbox-media://thumb/ 地址，主进程取原图、
 * 生成 WebP、落盘后返回（流程见 src/shared/media-url.ts 与 src/main/thumbnails）。
 *
 * Web/PWA（没有主进程）或来源不支持时原样返回原图地址。
 * 图片加载后交给 applyFocus 按焦点取景（focus.ts）。
 */
import {
  type ThumbWidth,
  pickThumbWidth,
  thumbUrl,
} from '../../../../shared/media-url'
import { isWebRuntime, serverThumbUrl } from '../library-server'

export { pickThumbWidth }
export { applyFocus } from './focus'

/** <img> 的地址：桌面端走缩略图协议，否则原图（网页端豆瓣图经片库服务代取，见 webImageSrc） */
export function thumbSrc(source: string, width: ThumbWidth): string {
  const desktop = typeof window !== 'undefined' && !!window.api
  return (desktop && thumbUrl(source, width)) || webImageSrc(source, width)
}

/** 豆瓣图床：只认 doubanio.com 及其子域名，且必须 https */
function isDoubanImage(source: string): boolean {
  try {
    const url = new URL(source)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'doubanio.com' ||
        url.hostname.endsWith('.doubanio.com'))
    )
  } catch {
    return false
  }
}

/**
 * 网页端的远程图片地址。豆瓣图床按 Referer 防盗链（不带或带错常回 418），浏览器的 <img> 给不了
 * movie.douban.com 的 Referer，所以只把豆瓣图改走片库服务的 /media/thumb（服务按名单带 Referer、
 * 有 SSRF 防护）。桌面端由主进程会话补 Referer，原样返回；其它来源也原样返回。
 */
export function webImageSrc(source: string, width: ThumbWidth = 780): string {
  if (!isWebRuntime() || !isDoubanImage(source)) return source
  return serverThumbUrl(source, width)
}
