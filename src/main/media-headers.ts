/**
 * 给少数需要防盗链头的媒体 CDN 注入 Referer，让渲染层直接播放 / 显示：
 * MissAV 的视频分片（surrit.com）与封面（fourhoi.com），番号库用到的 JavBus 图片（校验同源 Referer），
 * 以及豆瓣预告片（*.doubanio.com，悬停预览）。
 *
 * 取代原 Go 后端的 /api/missav/stream 与 /api/missav/cover 代理：请求仍走 Chromium，
 * 只改请求头，不经任何本地 HTTP 服务。
 *
 * 另外拦掉图床缺图时重定向去的占位图（DMM now_printing）：渲染层直连的剧照 / 封面会因此走 <img> 的 error，
 * 由界面隐藏，而不是显示一排「NOW PRINTING」。名单与规则在 src/shared/net/media-referer.ts（媒体库与独立服务共用）。
 */
import type { Session } from 'electron'
import {
  PLACEHOLDER_IMAGE_URLS,
  isPlaceholderImage,
} from '../shared/net/placeholder-image'
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

/** 拦掉重定向到图床占位图的那一跳（详见 shared/net/placeholder-image.ts）。 */
export function blockPlaceholderImages(session: Session): void {
  session.webRequest.onBeforeRequest(
    { urls: PLACEHOLDER_IMAGE_URLS },
    (details, callback) => callback({ cancel: isPlaceholderImage(details.url) })
  )
}
