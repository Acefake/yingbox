/**
 * 给少数需要防盗链头的媒体 CDN 注入 Referer，让渲染层直接播放 / 显示：
 * MissAV 的视频分片（surrit.com）与封面（fourhoi.com），番号库用到的 JavBus 图片（校验同源 Referer），
 * 以及豆瓣预告片（*.doubanio.com，悬停预览）。
 *
 * 取代原 Go 后端的 /api/missav/stream 与 /api/missav/cover 代理：请求仍走 Chromium，
 * 只改请求头，不经任何本地 HTTP 服务。名单与规则在 src/shared/net/media-referer.ts（媒体库与独立服务共用）。
 */
import type { Session } from 'electron'
import {
  MEDIA_REFERERS,
  MEDIA_REFERER_DOMAINS,
  refererFor,
} from '../shared/net/media-referer'

export { MEDIA_REFERERS, refererFor }

/** 在会话上安装请求头注入。 */
export function installMediaHeaders(session: Session): void {
  const urls = [
    ...Object.keys(MEDIA_REFERERS).map(host => `https://${host}/*`),
    ...Object.keys(MEDIA_REFERER_DOMAINS).flatMap(d => [
      `https://${d}/*`,
      `https://*.${d}/*`,
    ]),
  ]
  session.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const referer = refererFor(details.url)
    const requestHeaders = { ...details.requestHeaders }
    if (referer) requestHeaders.Referer = referer
    callback({ requestHeaders })
  })
}
