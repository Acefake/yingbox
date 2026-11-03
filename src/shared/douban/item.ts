/**
 * 豆瓣卡：引擎给的豆瓣条目 → 页面与视图用的卡，以及首屏补全（豆瓣详情 + TMDB 海报）。
 * 渲染层与服务端共用（ADR-0030）；取数函数由调用方注入。
 */
import type { DoubanMetadata } from './detail'
import type { DoubanKind, DoubanSubject } from './query'
import { type TmdbSearch, enrichFromTmdb } from './tmdb-enrich'

/** 豆瓣卡片（在线首页；也原样存进收藏 media_favorites） */
export interface DoubanItem {
  title: string
  /** 用来搜源的片名：TMDB 找到条目时换成 TMDB 的中文名 */
  searchTitle: string
  original_title: string
  /** 显示用封面：豆瓣封面，可由 TMDB 增强 */
  cover: string
  /** 豆瓣封面 */
  coverSrc: string
  /** 首页轮播横向剧照（豆瓣或 TMDB）；缺失时使用封面 */
  backdrop?: string
  /** 评分文字，无评分为「暂无」 */
  rate: string
  /** TMDB 评分（补全得到）；有豆瓣分数时界面仍显示豆瓣 */
  tmdbRate?: number
  /** movie.douban.com/subject/<id>/（去重键、取预告片用） */
  url: string
  year: string
  /** 「电影」/「剧集」 */
  type: string
  overview: string
  /** 来自「电影」还是「电视剧」分类（取预告片时用；旧收藏里没有，按电影取） */
  kind?: 'movie' | 'tv'
  /** TMDB 补全找到条目时的 TMDB id 与类型（取标志图等要用） */
  tmdbId?: number
  tmdbType?: 'movie' | 'tv'
  /** TMDB 标志图（透明底片名图）地址；只有首页轮播那几张去取，没有为空 */
  logo?: string
}

/** 引擎给的豆瓣卡 → 页面用的豆瓣条目（封面等 TMDB 补全后再填） */
export const doubanItemOf = (s: DoubanSubject): DoubanItem => ({
  title: s.title,
  searchTitle: s.title,
  original_title: '',
  cover: s.cover,
  coverSrc: s.cover,
  rate: s.rate || '暂无',
  url: s.url,
  year: s.year,
  type: s.kind === 'tv' ? '剧集' : '电影',
  overview: '',
  kind: s.kind,
})

const SUBJECT_RE =
  /^https?:\/\/(?:movie|m)\.douban\.com\/(?:movie\/)?subject\/(\d+)\/?/

/** 条目地址里的数字 ID；不是豆瓣条目地址返回 null */
export function doubanSubjectId(url: string): string | null {
  return SUBJECT_RE.exec(url)?.[1] ?? null
}

/** 补全要用的取数函数 */
export interface DoubanEnrichDeps {
  /** 豆瓣条目详情（online.doubanMetadata） */
  metadata: (
    subjectId: string,
    kind: DoubanKind
  ) => Promise<DoubanMetadata | null>
  /** TMDB 请求（online.tmdb）；没有令牌返回 null */
  search: TmdbSearch
}

/**
 * 豆瓣列表直接可用；前五项补豆瓣详情（简介、原名、剧照），再用 TMDB 补海报。
 * 直接改传入的条目（渲染层传响应式数组里的元素，改动即刷新卡片）。
 */
export async function enrichDoubanItems(
  items: DoubanItem[],
  kind: DoubanKind,
  deps: DoubanEnrichDeps
): Promise<void> {
  for (const item of items) {
    item.cover ||= item.coverSrc
    item.type ||= kind === 'tv' ? '剧集' : '电影'
  }
  // 只补首屏候选，其他条目打开详情时再取，避免一页触发几十次请求。
  const candidates = items.slice(0, 5)
  let next = 0
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (next < candidates.length) {
        const item = candidates[next++]
        const id = doubanSubjectId(item.url)
        if (!id) continue
        const detail = await deps
          .metadata(id, item.kind ?? kind)
          .catch(() => null)
        if (!detail) continue
        item.overview = detail.intro || item.overview
        item.original_title = detail.originalTitle || item.original_title
        item.year = detail.year || item.year
        item.backdrop = detail.backdrop || item.backdrop
        item.cover = detail.cover || item.cover
      }
    })
  )
  await enrichFromTmdb(items, kind, deps.search)
}
