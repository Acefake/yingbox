/**
 * 豆瓣剧照（在线详情页的剧照条兜底：TMDB 没配令牌、连不上或没有剧照时用）。
 *
 * m.douban.com/rexxar/api/v2/<movie|tv>/<id>/photos?start=0&count=40：移动端接口，要 Referer 与移动 UA。
 * 列表里海报和剧照混在一起：优先横图（宽 ≥ 高），横图不足 4 张时补上竖图，最多 20 张。
 * 结果缓存 1 小时；失败返回空数组、不缓存。按主机熔断（连续 3 次失败，冷却 10 分钟）。
 * 图片由渲染层直接取，doubanio.com 的 Referer 由主进程会话补（shared/net/media-referer.ts）。
 */
import type { DetailImage } from '../../shared/contract/online'
import type { NetClient } from '../../shared/net/client'
import {
  type HostBreaker,
  createHostBreaker,
} from '../../shared/net/host-breaker'

/** 一页剧照缓存 1 小时 */
export const PHOTOS_TTL_MS = 60 * 60 * 1000
/** 最多返回的张数 */
export const MAX_PHOTOS = 20
/** 横图少于这个数时补竖图 */
const MIN_LANDSCAPE = 4
const MAX_CACHE = 200

const REXXAR = 'https://m.douban.com/rexxar/api/v2'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

type Json = Record<string, unknown>

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null

const imageUrl = (value: unknown): string => {
  const url = asObject(value)?.url
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url)
    ? url
    : ''
}

interface Candidate extends DetailImage {
  landscape: boolean
}

/** 解析 photos 接口；不是 {photos: []}（验证页、错误）抛错 */
export function parseDoubanPhotos(json: unknown): DetailImage[] {
  const raw = asObject(json)?.photos
  if (!Array.isArray(raw)) throw new Error('豆瓣返回的不是剧照列表')
  const all: Candidate[] = []
  for (const entry of raw) {
    const image = asObject(asObject(entry)?.image)
    if (!image) continue
    const large = asObject(image.large)
    const full = imageUrl(large) || imageUrl(image.normal)
    const thumb = imageUrl(image.normal) || full
    if (!full) continue
    const width = Number(large?.width)
    const height = Number(large?.height)
    all.push({ thumb, full, landscape: !(height > width) })
  }
  const landscape = all.filter(c => c.landscape)
  const picked = landscape.length >= MIN_LANDSCAPE ? landscape : all
  return picked.slice(0, MAX_PHOTOS).map(({ thumb, full }) => ({ thumb, full }))
}

/** 取剧照的服务 */
export interface DoubanPhotos {
  /** 剧照列表；请求失败、熔断中返回空数组 */
  get(subjectId: string, kind: 'movie' | 'tv'): Promise<DetailImage[]>
}

/** 依赖 */
export interface DoubanPhotosOptions {
  net: NetClient
  now?: () => number
  breaker?: HostBreaker
}

/** 创建豆瓣剧照服务 */
export function createDoubanPhotos(options: DoubanPhotosOptions): DoubanPhotos {
  const { net } = options
  const now = options.now ?? Date.now
  const breaker =
    options.breaker ??
    createHostBreaker({ threshold: 3, cooldownMs: 10 * 60 * 1000, now })
  const cache = new Map<string, { photos: DetailImage[]; at: number }>()

  return {
    async get(subjectId, kind) {
      const url = `${REXXAR}/${kind}/${subjectId}/photos?start=0&count=40`
      const hit = cache.get(url)
      if (hit && now() - hit.at < PHOTOS_TTL_MS) return hit.photos
      if (breaker.check(url)) return []
      try {
        const json = await net.getJson(url, {
          headers: {
            Referer: 'https://m.douban.com/',
            'User-Agent': MOBILE_UA,
          },
          timeoutMs: 10_000,
        })
        const photos = parseDoubanPhotos(json)
        breaker.succeed(url)
        cache.delete(url)
        cache.set(url, { photos, at: now() })
        while (cache.size > MAX_CACHE)
          cache.delete(cache.keys().next().value as string)
        return photos
      } catch {
        breaker.fail(url, 'unreachable')
        return []
      }
    },
  }
}
