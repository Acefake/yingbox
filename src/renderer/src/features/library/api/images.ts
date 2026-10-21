/**
 * 媒体库图片地址：把引擎给的地址换成界面需要的尺寸。
 *
 * 引擎的 poster / backdrop 有两种形态：
 * - 已缓存：yingbox-media://image/<key>，换成 mediaImageUrl(key, 300 | 780) 取本地缩略图；
 * - 缓存失败：TMDB 远程地址（w500 / w1280），把尺寸段换成接近的远程尺寸，免得海报墙拉大图。
 * logo、季海报、剧照、演员头像只有 TMDB 远程地址或元数据里的相对路径（番号库是站点图片的绝对地址）。
 *
 * 这些函数在海报墙每格渲染时调用，用正则而不是 new URL，保持够快。
 */
import { type ThumbWidth, mediaImageUrl } from '../../../../../shared/media-url'

const TMDB_IMAGE = 'https://image.tmdb.org/t/p'
const MEDIA_KEY_RE = /^yingbox-media:\/\/image\/([0-9a-f]{32})/
const TMDB_RE = /^https:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9]+(\/.+)$/

/** 本地缩略图宽度 → 远程回退时用的 TMDB 尺寸。 */
const REMOTE_FOR_WIDTH: Record<ThumbWidth, string> = {
  300: 'w342',
  480: 'w500',
  780: 'w780',
}

/** 条目海报 / 背景图在界面上的地址；没有图返回 null。 */
export function itemImage(
  url: string | null,
  width: ThumbWidth
): string | null {
  if (!url) return null
  const key = MEDIA_KEY_RE.exec(url)?.[1]
  if (key) return mediaImageUrl(key, width)
  const path = TMDB_RE.exec(url)?.[1]
  if (path) return `${TMDB_IMAGE}/${REMOTE_FOR_WIDTH[width]}${path}`
  return url
}

/** TMDB 相对路径（/abc.jpg）→ 远程地址；已是绝对地址（番号站点图片）原样返回；路径为空返回 null。 */
export function tmdbImage(
  path: string | null | undefined,
  size: 'w185' | 'w300' | 'w500' | 'w780' = 'w185'
): string | null {
  if (!path) return null
  return /^https?:\/\//.test(path) ? path : `${TMDB_IMAGE}/${size}${path}`
}
