/**
 * 防盗链媒体 CDN 的 Referer 名单（纯函数，不依赖 Electron）。
 *
 * 桌面端主进程在会话上按名单注入请求头（src/main/media-headers.ts），
 * 媒体库下载原图、缩略图取原图、独立服务代理图片时也按同一份名单带 Referer。
 * 只匹配下面列出的主机。
 */

/** 主机 → 需要的 Referer */
export const MEDIA_REFERERS: Readonly<Record<string, string>> = {
  'surrit.com': 'https://missav.ai/',
  'fourhoi.com': 'https://missav.ai/',
  'www.javbus.com': 'https://www.javbus.com/',
  'www.getchu.com': 'https://www.getchu.com/',
}

/** 给定请求地址，返回需要注入的 Referer；不在名单里返回 undefined。 */
export function refererFor(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return undefined
    return MEDIA_REFERERS[url.hostname]
  } catch {
    return undefined
  }
}
