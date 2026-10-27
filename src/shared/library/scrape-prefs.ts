/**
 * 刮削偏好：元数据语言与写出图片的清晰度。
 *
 * 唯一来源是主设置（`scrape.metadataLanguage`、`scrape.imageSize.*`）：桌面端由主进程、
 * 独立服务（NAS）由服务端设置存储读出后经片库 RPC `setScrapePrefs` 下发给片库引擎，
 * 引擎存进自己的 settings 表（`scrape.prefs`）供识别 / 写出 / 追剧日历读取。纯函数与类型，两端共用。
 */

/** 可选的元数据语言（与设置 `scrape.metadataLanguage` 一致）。 */
export const METADATA_LANGUAGES = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
] as const
export type MetadataLanguage = (typeof METADATA_LANGUAGES)[number]

/** 图片清晰度档位（设置值沿用 TMDB 海报尺寸名：w342 标准 / w780 高清 / original 原图）。 */
export const IMAGE_QUALITIES = ['w342', 'w780', 'original'] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

/** 刮削偏好。 */
export interface ScrapePrefs {
  language: MetadataLanguage
  imageSize: {
    poster: ImageQuality
    backdrop: ImageQuality
    actor: ImageQuality
  }
}

/** 默认值：简体中文；图片高清（海报 w780、背景 w1280、头像 h632）。 */
export const DEFAULT_SCRAPE_PREFS: ScrapePrefs = {
  language: 'zh-CN',
  imageSize: { poster: 'w780', backdrop: 'w780', actor: 'w780' },
}

/** 组成刮削偏好的设置键。 */
export const SCRAPE_SETTING_KEYS = [
  'scrape.metadataLanguage',
  'scrape.imageSize.poster',
  'scrape.imageSize.backdrop',
  'scrape.imageSize.actor',
] as const
export type ScrapeSettingKey = (typeof SCRAPE_SETTING_KEYS)[number]

/** 是否是组成刮削偏好的设置键。 */
export const isScrapeSettingKey = (key: string): key is ScrapeSettingKey =>
  (SCRAPE_SETTING_KEYS as readonly string[]).includes(key)

/** 从设置读出刮削偏好（取值函数由宿主给：桌面 settings.json / 服务端设置文件）。 */
export function scrapePrefsFrom(
  get: (key: ScrapeSettingKey) => unknown
): ScrapePrefs {
  return parseScrapePrefs({
    language: get('scrape.metadataLanguage'),
    imageSize: {
      poster: get('scrape.imageSize.poster'),
      backdrop: get('scrape.imageSize.backdrop'),
      actor: get('scrape.imageSize.actor'),
    },
  })
}

const pick = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T => (allowed.includes(value as T) ? (value as T) : fallback)

/** 宽松解析：不认识的字段取默认值（RPC 参数、库里存的 JSON 都过这里）。 */
export function parseScrapePrefs(input: unknown): ScrapePrefs {
  const r = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >
  const size = (
    r.imageSize && typeof r.imageSize === 'object' ? r.imageSize : {}
  ) as Record<string, unknown>
  const d = DEFAULT_SCRAPE_PREFS
  return {
    language: pick(r.language, METADATA_LANGUAGES, d.language),
    imageSize: {
      poster: pick(size.poster, IMAGE_QUALITIES, d.imageSize.poster),
      backdrop: pick(size.backdrop, IMAGE_QUALITIES, d.imageSize.backdrop),
      actor: pick(size.actor, IMAGE_QUALITIES, d.imageSize.actor),
    },
  }
}

/** 写出用的 TMDB 图片尺寸。 */
export interface TmdbImageSizes {
  poster: string
  backdrop: string
  profile: string
}

/** 每个档位对应的 TMDB 尺寸（背景图、头像没有 w342 / w780 这两档，按清晰度对齐）。 */
const TIERS: Record<ImageQuality, TmdbImageSizes> = {
  w342: { poster: 'w342', backdrop: 'w780', profile: 'w185' },
  w780: { poster: 'w780', backdrop: 'w1280', profile: 'h632' },
  original: { poster: 'original', backdrop: 'original', profile: 'original' },
}

/** 偏好 → 写出用的 TMDB 尺寸。 */
export function tmdbImageSizes(size: ScrapePrefs['imageSize']): TmdbImageSizes {
  return {
    poster: TIERS[size.poster].poster,
    backdrop: TIERS[size.backdrop].backdrop,
    profile: TIERS[size.actor].profile,
  }
}

/** 是否中文（简 / 繁）。 */
export const isChineseLanguage = (language: string): boolean =>
  /^zh\b/i.test(language)
