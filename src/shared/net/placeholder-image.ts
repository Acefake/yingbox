/**
 * 图床占位图：图不存在时不报 404，而是重定向到一张「准备中」的通用图。
 * 这种图下载下来是合法 JPEG，不认出来就会当成海报存进库里，候选回退也不会发生。
 *
 * 目前只有 DMM：pics.dmm.co.jp 缺图时 302 到 imgsrc.dmm.com/…/now_printing/now_printing.jpg。
 * 用到的地方：媒体库下载原图（images/）、缩略图代取（main/thumbnails），
 * 以及桌面端渲染层直连远程图（main/media-headers 拦掉这一跳，<img> 走 error 而不是显示占位图）。
 */

/** 占位图所在的站点（Electron webRequest 过滤用）。 */
export const PLACEHOLDER_IMAGE_URLS = [
  'https://*.dmm.com/*',
  'https://*.dmm.co.jp/*',
]

/** 最终地址（跟随重定向之后）是不是占位图。 */
export function isPlaceholderImage(finalUrl: string | undefined): boolean {
  return Boolean(finalUrl && /\/now_printing\//i.test(finalUrl))
}
