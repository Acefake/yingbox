/**
 * 元数据源（TMDB 等）的抽象接口。本层只定义形状，不发网络请求；TMDB 实现在 src/main/library/providers/tmdb。
 */

/** 条目大类：电影或剧集（剧集指整部剧，不是单集）。 */
export type MediaKind = 'movie' | 'tv'

/** 已接入的元数据源名称。 */
export type ProviderName = 'tmdb'

/** 指向元数据源里一个条目的引用。 */
export interface MediaRef {
  provider: ProviderName
  kind: MediaKind
  id: string
}

/** 剧集某一季的集数信息。 */
export interface SeasonInfo {
  season: number
  episodeCount: number
}

/** 元数据源返回的候选条目，字段按打分需要取舍。 */
export interface Candidate {
  ref: MediaRef
  /** 当前语言下的标题。 */
  title: string
  /** 原始语言标题。 */
  originalTitle?: string
  /** 别名（TMDB alternative_titles）。 */
  alternativeTitles?: string[]
  /** 各语言译名（TMDB translations）。 */
  translations?: string[]
  /** 上映 / 首播年份。 */
  year?: number
  /** 电影时长（分钟）。 */
  runtimeMinutes?: number
  /** 剧集各季集数。 */
  seasons?: SeasonInfo[]
  /** 热度，只用于平局时排序。 */
  popularity?: number
  /** 海报路径（元数据源内路径），待确认列表展示用。 */
  posterPath?: string
  /** 简介（搜索结果语言），待确认列表展示摘要用。 */
  overview?: string
}

/** 标题搜索请求。 */
export interface SearchQuery {
  kind: MediaKind
  title: string
  year?: number
  /** 结果语言（如 zh-CN、en-US）；缺省由 provider 决定。 */
  language?: string
}

/** 可反查的外部 ID 来源。 */
export type ExternalIdSource = 'imdb' | 'tvdb'

/** 元数据源。 */
export interface MetadataProvider {
  readonly name: ProviderName
  /** 按标题（可带年份）搜索候选。 */
  search(query: SearchQuery, signal?: AbortSignal): Promise<Candidate[]>
  /** 按本源 ID 取详情（带全部别名、译名、时长、各季集数）；不存在时返回 null。 */
  details(
    kind: MediaKind,
    id: string,
    signal?: AbortSignal
  ): Promise<Candidate | null>
  /** 按外部 ID（imdb / tvdb）反查本源条目。 */
  find(
    source: ExternalIdSource,
    id: string,
    signal?: AbortSignal
  ): Promise<Candidate[]>
}
