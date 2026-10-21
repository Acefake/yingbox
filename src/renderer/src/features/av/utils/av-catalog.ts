/**
 * AV 分类浏览的纯规则：数据源条目、筛选栏、分类合并、排序、缓存键，
 * 以及 CMS / 插件 / MissAV 三种返回数据到统一条目的整理。
 */
import type { MediaFilterRow } from '@/components/MediaFilterBar.vue'
import type { MissavCatalogItem } from '../api/missav'
import { missavCover } from '../api/missav'

/** 浏览数据源：MissAV 目录、AV CMS 源、成人插件源。 */
export type AvEntry = {
  api: string
  name: string
  kind: 'cms' | 'plugin' | 'missav'
}
export type BrowseSort = 'latest' | 'hot' | 'rating'
export type BrowseCategory = {
  id: number | null
  name: string
  ext?: Record<string, any>
}
/** 每个数据源上次停留的分类与排序。 */
export type BrowseVisit = {
  categoryId: number | null
  categoryName: string
  sort: BrowseSort
}
/** 一页浏览结果（内存缓存的单元）。 */
export type BrowseCacheEntry = {
  items: any[]
  pageCount: number
  total: number
  categories: BrowseCategory[]
}

export const MISSAV_SOURCE = 'missav://catalog'
export const MISSAV_CATEGORIES: BrowseCategory[] = [
  { id: 0, name: '最新更新', ext: { slug: 'new' } },
  { id: 1, name: '新作发布', ext: { slug: 'release' } },
  { id: 2, name: '中文字幕', ext: { slug: 'chinese-subtitle' } },
  { id: 3, name: '无码流出', ext: { slug: 'uncensored-leak' } },
  { id: 4, name: '英语字幕', ext: { slug: 'english-subtitle' } },
  { id: 5, name: 'FC2', ext: { slug: 'fc2' } },
  { id: 6, name: '麻豆传媒', ext: { slug: 'madou' } },
  { id: 7, name: 'HEYZO', ext: { slug: 'heyzo' } },
]
/** 内存里最多缓存的浏览页数（超出时丢最早的）。 */
export const BROWSE_CACHE_LIMIT = 60

/** 「全部」分类（CMS 源默认的唯一分类）。 */
export const allCategories = (): BrowseCategory[] => [
  { id: null, name: '全部' },
]

/** 数据源条目：MissAV 在最前，其次 CMS 源、插件源。 */
export const buildAvEntries = (
  cms: { api: string; name: string }[],
  plugins: { api: string; name: string }[]
): AvEntry[] => [
  { api: MISSAV_SOURCE, name: 'MissAV', kind: 'missav' },
  ...cms.map(s => ({ api: s.api, name: s.name, kind: 'cms' as const })),
  ...plugins.map(s => ({ api: s.api, name: s.name, kind: 'plugin' as const })),
]

/** 筛选栏三行：数据源（插件源排在 CMS 前，免得被一长串 CMS 挤到看不见）、排序、分类。 */
export const buildFilterRows = (
  entries: AvEntry[],
  sourceApi: string,
  categories: BrowseCategory[]
): MediaFilterRow[] => [
  {
    key: 'source',
    label: '数据源',
    options: (['missav', 'plugin', 'cms'] as const)
      .flatMap(kind => entries.filter(entry => entry.kind === kind))
      .map(entry => ({
        label: entry.kind === 'plugin' ? `${entry.name}（插件）` : entry.name,
        value: entry.api,
      })),
  },
  {
    key: 'sort',
    label: '排序',
    options:
      sourceApi === MISSAV_SOURCE
        ? [
            { label: '最新更新', value: 'latest' },
            { label: '本月热度', value: 'hot' },
            { label: '总浏览', value: 'rating' },
          ]
        : [
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

/** 本地排序：热度看周点击、评分看分数、默认按添加时间倒序。MissAV 由服务端排好，不动。 */
export const sortBrowseVideos = (
  videos: any[],
  sort: BrowseSort,
  serverSorted: boolean
): any[] => {
  if (serverSorted) return videos
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
  items: any[]
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

/** 浏览缓存键：插件与 MissAV 按分类名区分，CMS 按分类 id。 */
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
export const mergePage = (current: any[], page: any[], append: boolean) => {
  const items = append ? [...current, ...page] : page
  return Array.from(new Map(items.map(item => [item._uid, item])).values())
}

/** CatSpider 配置里的 tabs → 分类（无名称时叫「分类N」）。 */
export const parsePluginTabs = (data: any): BrowseCategory[] => {
  const config = data?.config || data?.data?.config || data
  const tabList = Array.isArray(config?.tabs) ? config.tabs : []
  return tabList.map((tab: any, index: number) => ({
    id: index,
    name: tab.name || `分类${index + 1}`,
    ext: tab.ext || {},
  }))
}

/** 插件条目：vod_id 缺失时用 ext.url，标记 _isPlugin 供播放走插件解析。 */
export const toPluginItems = (list: any[], siteName: string): any[] =>
  list.map(item => ({
    ...item,
    vod_id: item.vod_id || item.ext?.url || '',
    _source: siteName,
    _uid: `${siteName}-${item.vod_id || item.ext?.url || ''}`,
    _isPlugin: true,
    _siteName: siteName,
    _ext: item.ext || {},
  }))

/** CMS 条目：补上来源名与唯一键。 */
export const toCmsItems = (list: any[], sourceName: string): any[] =>
  list.map(item => ({
    ...item,
    _source: sourceName,
    _uid: `${sourceName}-${item.vod_id}`,
  }))

/** MissAV 目录条目 → 统一条目（封面用番号拼，番号大写放角标）。 */
export const toMissavItems = (
  items: MissavCatalogItem[],
  categoryName: string
): any[] =>
  items.map(item => ({
    vod_id: item.code,
    vod_name: item.title,
    vod_pic: missavCover(item.code),
    vod_remarks: item.code.toUpperCase(),
    vod_duration: item.duration || '',
    type_name: categoryName,
    _source: 'MissAV',
    _uid: `missav-${item.code}`,
    _missavInput: item.code,
  }))

/** 当前分类对应的 MissAV 目录 slug，找不到时用 new。 */
export const missavSlug = (
  categories: BrowseCategory[],
  categoryName: string
): string =>
  String(categories.find(c => c.name === categoryName)?.ext?.slug || 'new')

/** MissAV 分类（拷贝一份）以及上次停留的分类（没有就第一个）。 */
export const missavCategoriesFor = (saved?: BrowseVisit) => {
  const categories = MISSAV_CATEGORIES.map(c => ({ ...c, ext: { ...c.ext } }))
  const match =
    categories.find(c => c.name === saved?.categoryName) || categories[0]
  return { categories, match }
}
