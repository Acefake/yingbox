import { call, defineDomain, int, oneOf, str } from './define'

/** MissAV 目录分类。 */
export type AvCategory =
  | 'new'
  | 'release'
  | 'chinese-subtitle'
  | 'uncensored-leak'
  | 'english-subtitle'
  | 'fc2'
  | 'madou'
  | 'heyzo'

/** 目录排序。 */
export type AvSort = 'latest' | 'hot' | 'rating'

const CATEGORY_IDS = [
  'new',
  'release',
  'chinese-subtitle',
  'uncensored-leak',
  'english-subtitle',
  'fc2',
  'madou',
  'heyzo',
] as const satisfies readonly AvCategory[]
const SORT_IDS = [
  'latest',
  'hot',
  'rating',
] as const satisfies readonly AvSort[]

/** 一页目录。 */
export interface AvCatalogPage {
  category: AvCategory
  page: number
  pageCount: number
  categories: Array<{ id: AvCategory; name: string }>
  items: Array<{
    code: string
    title: string
    poster: string
    duration: string
  }>
}

/** 解析出的播放地址：surrit.com 的 HLS，渲染层直连（Referer 由主进程注入）。 */
export interface AvStream {
  url: string
  title: string
  input: string
}

/** AV 域：MissAV 目录与播放地址，在引擎经 net 出网（取代 Go + curl_cffi）。 */
export const av = defineDomain('av', {
  /** 拉一页目录 */
  list: call<[category: AvCategory, page: number, sort: AvSort], AvCatalogPage>(
    a => [
      oneOf(a[0], 'category', CATEGORY_IDS),
      int(a[1], 'page'),
      oneOf(a[2], 'sort', SORT_IDS),
    ]
  ),
  /** 番号或 MissAV 链接 → HLS 地址 */
  resolve: call<[input: string], AvStream>(a => [str(a[0], 'input')]),
})
