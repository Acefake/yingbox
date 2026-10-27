/**
 * TMDB 映射共用的文本小工具：年份、空串归一、文本语言回退与译文挑选、详情类型判断。纯函数。
 */
import type { MediaKind } from '../../../../shared/library/provider'
import type {
  TmdbMovieDetails,
  TmdbTranslation,
  TmdbTvDetails,
} from './tmdb-types'

/** 详情（电影或剧集）。 */
export type TmdbDetails = TmdbMovieDetails | TmdbTvDetails

/** 'YYYY-MM-DD' → 年份。 */
export function yearOf(date?: string | null): number | undefined {
  const m = date ? /^(\d{4})/.exec(date) : null
  return m ? Number(m[1]) : undefined
}

/** 去掉首尾空白；空串、null、undefined 都返回 undefined。 */
export const nonEmpty = (s?: string | null): string | undefined =>
  s && s.trim() ? s.trim() : undefined

/**
 * 文本语言回退链（标题以外：简介按这条链挑）。中文：zh-CN → zh-TW → zh-HK → zh-SG → 任意 zh → en-US → 任意 en；
 * 其他语言：自身 → en-US → 任意 en。
 */
export function languageChain(language: string): string[] {
  const { native, fallback } = languageChains(language)
  return [...new Set([...native, ...fallback])]
}

/**
 * 分成两段的回退链：native 是同一种语言的各地区写法，fallback 是外语兜底（中文时为英文）。
 * 中文片名缺失时用原名而不是英文（见 tmdb-map.ts metadataFromDetails），所以要分开。
 */
export function languageChains(language: string): {
  native: string[]
  fallback: string[]
} {
  if (language.startsWith('zh'))
    return {
      native: [
        ...new Set([language, 'zh-CN', 'zh-TW', 'zh-HK', 'zh-SG', 'zh']),
      ],
      fallback: ['en-US', 'en'],
    }
  return { native: [language], fallback: ['en-US', 'en'] }
}

/** 按回退链从 translations 里挑一个非空字段，返回值与所用语言。 */
export function pickTranslation(
  translations: TmdbTranslation[] | undefined,
  chain: string[],
  field: (t: TmdbTranslation) => string | undefined
): { value: string; language: string } | undefined {
  if (!translations?.length) return undefined
  for (const tag of chain) {
    const [lang, region] = tag.split('-')
    for (const t of translations) {
      if (t.iso_639_1 !== lang) continue
      if (region && t.iso_3166_1 !== region) continue
      const value = nonEmpty(field(t))
      if (value) return { value, language: `${lang}-${t.iso_3166_1 ?? ''}` }
    }
  }
  return undefined
}

/** 按 kind 判断详情是不是电影（类型收窄用）。 */
export const isMovie = (
  kind: MediaKind,
  _d: TmdbDetails
): _d is TmdbMovieDetails => kind === 'movie'
