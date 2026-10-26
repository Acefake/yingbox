/**
 * 媒体库 IPC 契约 · 分面筛选：海报墙按类型 / 标签 / 演员 / 制作商 / 系列 / 导演筛选，
 * 以及列出每个分面有哪些取值（带条目数），供筛选面板直接点选。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */
import type { JavKind, LibrarySource } from './contract-jav'

/** 可筛选的分面。kind 是番号类别（有码 / 无码 / FC2 / 素人），按番号判定。 */
export type FacetField =
  | 'kind'
  | 'tag'
  | 'actor'
  | 'studio'
  | 'series'
  | 'director'

/** 全部分面，校验用。 */
export const FACET_FIELDS: readonly FacetField[] = [
  'kind',
  'tag',
  'actor',
  'studio',
  'series',
  'director',
]

/**
 * 海报墙的分面筛选。分面之间同时满足；同一分面里标签要全部带上（越选越窄），
 * 其余分面任一即可（选两个演员 = 两人的作品都出来）。
 */
export interface FacetFilter {
  kind?: JavKind[]
  tag?: string[]
  actor?: string[]
  studio?: string[]
  series?: string[]
  director?: string[]
}

/** 列出分面取值的请求。范围与海报墙一致（来源、媒体库），search 按取值模糊匹配。 */
export interface FacetListRequest {
  field: FacetField
  source?: LibrarySource
  libraryId?: number
  /** 只算这些顶层类型（电影页传 movie、剧集页传 series：两者同为 tmdb 来源）；缺省两种都算。 */
  types?: Array<'movie' | 'series'>
  search?: string
  /** 最多返回几条，默认 60。 */
  limit?: number
}

/** 一个分面取值与它的条目数。 */
export interface FacetValue {
  value: string
  count: number
}

/** 分面相关的方法。 */
export interface FacetRpcMap {
  'facets.list': { params: FacetListRequest; result: FacetValue[] }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const FACET_METHODS = [
  'facets.list',
] as const satisfies readonly (keyof FacetRpcMap)[]

/** window.api.library 上的分面方法。 */
export interface LibraryFacetsBridge {
  facets: {
    /** 某个分面的取值，按条目数从多到少。 */
    list(request: FacetListRequest): Promise<FacetValue[]>
  }
}
