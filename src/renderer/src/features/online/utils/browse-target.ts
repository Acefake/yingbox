/**
 * 首页「浏览页」的目标：热门（全部类型）、某个类型、某个精选片单；以及目标 ↔ 路由参数 ↔ 豆瓣查询条件的换算。
 *
 * 浏览页挂在首页路由上（`/?browse=genre&genre=科幻&kind=movie`），侧栏「首页」保持高亮，浏览器后退回到首页。
 * - hot：热门电影 / 剧集的「›」，类型 = 全部，可加排序 / 地区 / 年代 / 评分；
 * - genre：快速浏览胶囊，类型固定，其余同上，可切电影 / 剧集；
 * - list：精选片单，映射到豆瓣快捷标签（与多维筛选互斥，所以片单页不显示筛选胶囊）。
 */
import {
  COLLECTIONS,
  type CollectionId,
  collectionOf,
  collectionQuery,
  genreQuery,
} from '../../../../../shared/douban/collections'
import {
  type DoubanKind,
  type DoubanQuery,
  GENRES,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../../../../../shared/douban/query'

/** 浏览页显示什么 */
export type BrowseTarget =
  | { type: 'hot'; kind: DoubanKind }
  | { type: 'genre'; genre: string; kind: DoubanKind }
  | { type: 'list'; list: CollectionId }

/** 目标的基础查询条件（刚进入浏览页时） */
export function baseQuery(target: BrowseTarget): DoubanQuery {
  if (target.type === 'list') return collectionQuery(collectionOf(target.list))
  if (target.type === 'genre') return genreQuery(target.genre, target.kind)
  return defaultDoubanQuery(target.kind)
}

/** 浏览页大标题 */
export function browseTitle(target: BrowseTarget): string {
  if (target.type === 'list') return collectionOf(target.list).title
  if (target.type === 'genre') return target.genre
  return '全部'
}

const one = (value: unknown): string =>
  typeof value === 'string' ? value : Array.isArray(value) ? one(value[0]) : ''

/** 路由参数 → 目标；不是浏览页（或参数不合法）时返回 null */
export function targetFromRoute(
  query: Record<string, unknown>
): BrowseTarget | null {
  const kind: DoubanKind = one(query.kind) === 'tv' ? 'tv' : 'movie'
  switch (one(query.browse)) {
    case 'hot':
      return { type: 'hot', kind }
    case 'genre': {
      const genre = one(query.genre)
      return GENRES[kind].includes(genre)
        ? { type: 'genre', genre, kind }
        : null
    }
    case 'list': {
      const list = one(query.list)
      return COLLECTIONS.some(c => c.id === list)
        ? { type: 'list', list: list as CollectionId }
        : null
    }
    default:
      return null
  }
}

/** 目标 → 路由参数（与 targetFromRoute 互逆） */
export function routeQueryOf(target: BrowseTarget): Record<string, string> {
  if (target.type === 'list') return { browse: 'list', list: target.list }
  if (target.type === 'genre')
    return { browse: 'genre', genre: target.genre, kind: target.kind }
  return { browse: 'hot', kind: target.kind }
}

/** 两个目标是不是同一个页面（只看类型 / 片单，不看电影还是剧集） */
const samePage = (a: BrowseTarget, b: BrowseTarget): boolean =>
  a.type === b.type &&
  (a.type !== 'genre' || a.genre === (b as typeof a).genre) &&
  (a.type !== 'list' || a.list === (b as typeof a).list)

/** 当前条件是否已经是这个目标的（可能带着用户加的筛选） */
function fits(target: BrowseTarget, q: DoubanQuery): boolean {
  if (target.type === 'list') {
    const c = collectionOf(target.list)
    return q.kind === c.kind && q.tag === c.tag
  }
  if (q.kind !== target.kind) return false
  if (target.type === 'genre') return q.genre === target.genre
  return !q.genre && (q.tag === '热门' || q.tag === '')
}

/**
 * 进入 / 切换浏览目标时该换成的查询条件；当前条件已经合适时返回 null（不重取，保留会话里记住的筛选）。
 * @param target - 新目标
 * @param current - 浏览列表当前的条件
 * @param prev - 上一个目标（同一页面只切了电影 / 剧集时保留排序、地区等筛选）
 */
export function nextBrowseQuery(
  target: BrowseTarget,
  current: DoubanQuery,
  prev?: BrowseTarget | null
): DoubanQuery | null {
  if (prev && target.type !== 'list' && samePage(prev, target)) {
    if (fits(target, current)) return null
    return normalizeDoubanQuery({
      ...current,
      kind: target.kind,
      tag: target.type === 'hot' ? '热门' : '',
      genre: target.type === 'genre' ? target.genre : '',
    })
  }
  if (!prev && fits(target, current)) return null
  if (prev && samePage(prev, target) && fits(target, current)) return null
  return baseQuery(target)
}
