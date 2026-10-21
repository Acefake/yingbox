/**
 * yingbox-media:// 地址：全应用缓存图片与缩略图的唯一入口（主进程 src/main/thumbnails 提供）。
 *
 * 两种形态：
 * - `yingbox-media://image/<key>[?w=300]`：媒体库引擎已下载的原图（key 是远程 URL 的哈希），
 *   带 w 取缩略图，缺省为原图。引擎把这种地址存进数据库，形态不能改；
 * - `yingbox-media://thumb/?w=300&src=<来源>`：任意来源（http(s)、本地 file:///）
 *   的缩略图，主进程取原图、缩放、编码 WebP、落盘后返回。
 *
 * 缩略图只生成 THUMB_WIDTHS 这几档，防止任意尺寸把缓存撑爆。内容按来源不可变，响应带一年强缓存。
 */

/** 协议名。 */
export const MEDIA_SCHEME = 'yingbox-media'

/** 生成的缩略图宽度（媒体库海报墙用 300 / 780，海报卡按 dpr 取 300 / 480 / 780）。 */
export const THUMB_WIDTHS = [300, 480, 780] as const

/** 缩略图宽度。 */
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** 图片 key：URL 的 SHA-1 前 32 位十六进制。 */
export const IMAGE_KEY_RE = /^[0-9a-f]{32}$/

/** 本地图片只认这些扩展名（缩略图协议不是通用文件读取口）。 */
const LOCAL_IMAGE_RE = /^file:\/\/\/.+\.(jpe?g|png|webp|bmp)$/i

/** 解析结果：媒体库原图（可带宽度）或任意来源的缩略图。 */
export type MediaTarget =
  | { kind: 'image'; key: string; width?: ThumbWidth }
  | { kind: 'thumb'; source: string; width: ThumbWidth }

/** 某张媒体库缓存图片的地址；width 缺省为原图。 */
export function mediaImageUrl(key: string, width?: ThumbWidth): string {
  return `${MEDIA_SCHEME}://image/${key}${width ? `?w=${width}` : ''}`
}

/** 可以生成缩略图的来源：http(s)、本地图片（file:///…，限图片扩展名）。 */
export function isThumbSource(source: string): boolean {
  return /^https?:\/\//i.test(source) || LOCAL_IMAGE_RE.test(source)
}

/** 任意来源的缩略图地址；来源不支持时返回 null。 */
export function thumbUrl(source: string, width: ThumbWidth): string | null {
  if (!isThumbSource(source)) return null
  return `${MEDIA_SCHEME}://thumb/?w=${width}&src=${encodeURIComponent(source)}`
}

/** 取不小于 cssWidth × dpr 的最小档位（超出最大档用最大档）。 */
export function pickThumbWidth(cssWidth: number, dpr = 1): ThumbWidth {
  const need = Math.ceil(cssWidth * Math.max(1, dpr))
  return THUMB_WIDTHS.find(w => w >= need) ?? THUMB_WIDTHS.at(-1)!
}

const isWidth = (value: number): value is ThumbWidth =>
  (THUMB_WIDTHS as readonly number[]).includes(value)

/** 解析 yingbox-media 地址；不合法返回 null。 */
export function parseMediaUrl(url: string): MediaTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
  const w = parsed.searchParams.get('w')
  const width = Number(w)
  if (parsed.hostname === 'image') {
    const key = parsed.pathname.replace(/^\/+/, '')
    if (!IMAGE_KEY_RE.test(key)) return null
    if (w === null) return { kind: 'image', key }
    return isWidth(width) ? { kind: 'image', key, width } : null
  }
  if (parsed.hostname === 'thumb') {
    const source = parsed.searchParams.get('src') ?? ''
    if (!isThumbSource(source) || !isWidth(width)) return null
    return { kind: 'thumb', source, width }
  }
  return null
}
