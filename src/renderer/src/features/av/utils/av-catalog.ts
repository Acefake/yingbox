/**
 * AV 分类浏览的纯规则：数据源条目、筛选栏、分类合并、排序、缓存键，
 * 以及 CMS / 插件两种返回数据到统一条目的整理。
 */
import type { MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { asText } from '@/utils/json'
import {
  type PluginExt,
  type RawVod,
  asRawVod,
  pluginTabs,
} from '@/utils/vod-data'

/**
 * AV 条目：CMS、插件两种来源整理成同一形状，浏览、搜索、播放、收藏、历史都用它。
 * 原始字段（vod_*）照搬来源，下划线字段是整理时补的。
 */
export interface AvVideo extends RawVod {
  vod_id: string | number
  /** 来源名（CMS 站名 / 插件名） */
  _source: string
  /** 去重键：来源 + vod_id */
  _uid: string
  /** 插件条目：播放要先经插件取线路 */
  _isPlugin?: boolean
  _siteName?: string
  _ext?: PluginExt
}

/** 浏览数据源：AV CMS 源、成人插件源。 */
export type AvEntry = {
  api: string
  name: string
  kind: 'cms' | 'plugin'
}
export type BrowseSort = 'latest' | 'hot' | 'rating'
export type BrowseCategory = {
  id: number | null
  name: string
  ext?: PluginExt
}
/** 每个数据源上次停留的分类与排序。 */
export type BrowseVisit = {
  categoryId: number | null
  categoryName: string
  sort: BrowseSort
}
/** 一页浏览结果（内存缓存的单元）。 */
export type BrowseCacheEntry = {
  items: AvVideo[]
  pageCount: number
  total: number
  categories: BrowseCategory[]
}

/** 内存里最多缓存的浏览页数（超出时丢最早的）。 */
export const BROWSE_CACHE_LIMIT = 60

/** 「全部」分类（CMS 源默认的唯一分类）。 */
export const allCategories = (): BrowseCategory[] => [
  { id: null, name: '全部' },
]

/** 数据源条目：CMS 源、插件源。 */
export const buildAvEntries = (
  cms: { api: string; name: string }[],
  plugins: { api: string; name: string }[]
): AvEntry[] => [
  ...cms.map(s => ({ api: s.api, name: s.name, kind: 'cms' as const })),
  ...plugins.map(s => ({ api: s.api, name: s.name, kind: 'plugin' as const })),
]

/** 筛选栏三行：数据源（插件源排在 CMS 前，免得被一长串 CMS 挤到看不见）、排序、分类。 */
export const buildFilterRows = (
  entries: AvEntry[],
  categories: BrowseCategory[]
): MediaFilterRow[] => [
  {
    key: 'source',
    label: '数据源',
    options: (['plugin', 'cms'] as const)
      .flatMap(kind => entries.filter(entry => entry.kind === kind))
      .map(entry => ({
        label: entry.kind === 'plugin' ? `${entry.name}（插件）` : entry.name,
        value: entry.api,
      })),
  },
  {
    key: 'sort',
    label: '排序',
    options: [
      { label: '最新发布', value: 'latest' },
      { label: '本周热度', value: 'hot' },
      { label: '评分优先', value: 'rating' },
    ],
  },
  {
    key: 'category',
    label: '分类',
    options: categories.map(c => ({ label: c.name, value: c.name })),
  },
]

/** 本地排序：热度看周点击、评分看分数、默认按添加时间倒序。 */
export const sortBrowseVideos = <T extends RawVod>(
  videos: T[],
  sort: BrowseSort
): T[] => {
  return [...videos].sort((a, b) => {
    if (sort === 'hot')
      return Number(b.vod_hits_week || 0) - Number(a.vod_hits_week || 0)
    if (sort === 'rating')
      return Number(b.vod_score || 0) - Number(a.vod_score || 0)
    return String(b.vod_time_add || b.vod_time || '').localeCompare(
      String(a.vod_time_add || a.vod_time || '')
    )
  })
}

/** 把条目里出现的新分类（type_id / type_name）并入已有分类，「全部」在前，其余按中文排序。 */
export const mergeCategories = (
  existing: BrowseCategory[],
  items: RawVod[]
): BrowseCategory[] => {
  const byId = new Map<number, BrowseCategory>(
    existing
      .filter((c): c is BrowseCategory & { id: number } => c.id !== null)
      .map(c => [c.id, c])
  )
  for (const item of items) {
    const name = String(item.type_name ?? '').trim()
    const id = Number(item.type_id)
    if (Number.isFinite(id) && name && !byId.has(id)) byId.set(id, { id, name })
  }
  return [
    ...allCategories(),
    ...Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    ),
  ]
}

/** 浏览缓存键：插件按分类名区分，CMS 按分类 id。 */
export const browseCacheKey = (q: {
  sourceApi: string
  byName: boolean
  categoryName: string
  categoryId: number | null
  page: number
  sort: BrowseSort
}): string =>
  `${q.sourceApi}|${q.byName ? q.categoryName : (q.categoryId ?? 'all')}|${q.page}|${q.sort}`

/** CMS 分类浏览地址（ac=detail&pg=N[&t=分类]）。 */
export const createBrowseUrl = (
  api: string,
  page: number,
  categoryId: number | null
): string => {
  const params = new URLSearchParams({ ac: 'detail', pg: String(page) })
  if (categoryId !== null) params.set('t', String(categoryId))
  return `${api}?${params}`
}

/** 写入有上限的 Map（超出时删最早写入的键）。 */
export const rememberBounded = <V>(
  map: Map<string, V>,
  key: string,
  value: V,
  limit = BROWSE_CACHE_LIMIT
): void => {
  map.set(key, value)
  if (map.size > limit) map.delete(map.keys().next().value as string)
}

/** 追加或替换一页，并按 _uid 去重（后出现的覆盖先出现的，位置保留在首次出现处）。 */
export const mergePage = <T extends { _uid: string }>(
  current: T[],
  page: T[],
  append: boolean
): T[] => {
  const items = append ? [...current, ...page] : page
  return Array.from(new Map(items.map(item => [item._uid, item])).values())
}

/** CatSpider 配置里的 tabs → 分类（无名称时叫「分类N」）。 */
export const parsePluginTabs = (data: unknown): BrowseCategory[] =>
  pluginTabs(data).map((tab, index) => ({
    id: index,
    name: tab.name || `分类${index + 1}`,
    ext: tab.ext,
  }))

/** 插件条目：vod_id 缺失时用 ext.url，标记 _isPlugin 供播放走插件解析。 */
export const toPluginItems = (list: unknown[], siteName: string): AvVideo[] =>
  list.map(asRawVod).map(item => ({
    ...item,
    vod_id: item.vod_id || asText(item.ext?.url),
    _source: siteName,
    _uid: `${siteName}-${item.vod_id || asText(item.ext?.url)}`,
    _isPlugin: true,
    _siteName: siteName,
    _ext: item.ext || {},
  }))

/** CMS 条目：补上来源名与唯一键。 */
export const toCmsItems = (list: unknown[], sourceName: string): AvVideo[] =>
  list.map(asRawVod).map(item => ({
    ...item,
    vod_id: item.vod_id ?? '',
    _source: sourceName,
    _uid: `${sourceName}-${item.vod_id}`,
  }))
