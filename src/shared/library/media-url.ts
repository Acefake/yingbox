/**
 * yingbox-media:// 地址：媒体库缓存图片的统一入口（主进程协议处理器提供）。
 *
 * 形如 yingbox-media://image/<key>?w=300。key 是远程图片 URL 的哈希，内容不可变，
 * 所以协议响应带一年的 immutable 强缓存。w 只能取 THUMB_WIDTHS，缺省为原图。
 */

/** 协议名。 */
export const MEDIA_SCHEME = 'yingbox-media'

/** 生成的缩略图宽度。 */
export const THUMB_WIDTHS = [300, 780] as const

/** 缩略图宽度。 */
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** 图片 key：URL 的 SHA-1 前 32 位十六进制。 */
export const IMAGE_KEY_RE = /^[0-9a-f]{32}$/

/** 某张缓存图片的地址；width 缺省为原图。 */
export function mediaImageUrl(key: string, width?: ThumbWidth): string {
  return `${MEDIA_SCHEME}://image/${key}${width ? `?w=${width}` : ''}`
}

/** 解析 yingbox-media 图片地址；不合法返回 null。 */
export function parseMediaImageUrl(
  url: string
): { key: string; width?: ThumbWidth } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== 'image') {
    return null
  }
  const key = parsed.pathname.replace(/^\/+/, '')
  if (!IMAGE_KEY_RE.test(key)) return null
  const w = parsed.searchParams.get('w')
  if (w === null) return { key }
  const width = Number(w) as ThumbWidth
  return THUMB_WIDTHS.includes(width) ? { key, width } : null
}
