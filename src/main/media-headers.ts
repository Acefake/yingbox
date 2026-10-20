/**
 * 给少数需要防盗链头的媒体 CDN 注入 Referer，让渲染层直接播放 / 显示：
 * MissAV 的视频分片（surrit.com）与封面（fourhoi.com）。
 *
 * 取代原 Go 后端的 /api/missav/stream 与 /api/missav/cover 代理：请求仍走 Chromium，
 * 只改请求头，不经任何本地 HTTP 服务。只匹配下面列出的主机。
 */
import type { Session } from 'electron'

/** 主机 → 需要的 Referer */
export const MEDIA_REFERERS: Readonly<Record<string, string>> = {
  'surrit.com': 'https://missav.ai/',
  'fourhoi.com': 'https://missav.ai/',
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

/** 在会话上安装请求头注入。 */
export function installMediaHeaders(session: Session): void {
  const urls = Object.keys(MEDIA_REFERERS).map(host => `https://${host}/*`)
  session.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const referer = refererFor(details.url)
    const requestHeaders = { ...details.requestHeaders }
    if (referer) requestHeaders.Referer = referer
    callback({ requestHeaders })
  })
}
