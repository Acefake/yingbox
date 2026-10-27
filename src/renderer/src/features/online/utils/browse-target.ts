/**
 * 首页「浏览页」的目标：热门（全部类型）、某个类型、某个精选片单；以及目标 ↔ 路由参数 ↔ 豆瓣查询条件的换算。
 *
 * 浏览页挂在首页路由上（`/?browse=genre&genre=科幻&kind=movie`），侧栏「首页」保持高亮，浏览器后退回到首页。
 * - hot：热门电影 / 剧集的「›」，类型 = 全部，可加排序 / 地区 / 年代 / 评分；
 * - genre：按类型浏览的大卡，类型固定，其余同上，可切电影 / 剧集；
 * - list：精选片单，映射到豆瓣快捷标签（与多维筛选互斥，所以片单页不显示筛选胶囊）。
 */
import {
  type DoubanKind,
  type DoubanQuery,
  GENRES,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../../../../../shared/douban/query'

/** 精选片单的标识 */
export type CollectionId = 'top' | 'gems' | 'chinese' | 'kdrama'

/** 浏览页显示什么 */
export type BrowseTarget =
  | { type: 'hot'; kind: DoubanKind }
  | { type: 'genre'; genre: string; kind: DoubanKind }
  | { type: 'list'; list: CollectionId }

/** 首页精选片单的一张卡 */
export interface Collection {
  id: CollectionId
  /** 左上角英文小标签 */
  kicker: string
  title: string
  /** 一句描述 */
  blurb: string
  kind: DoubanKind
  /** 对应的豆瓣快捷标签（shared/douban/query.ts 的 QUICK_TAGS） */
  tag: string
}

/** 「按类型浏览」的 6 个类型：电影、剧集两边的类型表里都有，切电影 / 剧集时不丢 */
export const HOME_GENRES = ['科幻', '动作', '喜剧', '悬疑', '动画', '爱情']

/** 「精选片单」：引擎快捷标签里最接近的四个 */
export const COLLECTIONS: readonly Collection[] = [
  {
    id: 'top',
    kicker: 'TOP RATED',
    title: '豆瓣高分',
    blurb: '口碑过硬、经得起时间的好片。',
    kind: 'movie',
    tag: '豆瓣高分',
  },
  {
    id: 'gems',
    kicker: 'HIDDEN GEMS',
    title: '冷门佳片',
    blurb: '看的人不多，看过的都说好。',
    kind: 'movie',
    tag: '冷门佳片',
  },
  {
    id: 'chinese',
    kicker: 'CHINESE',
    title: '华语热门',
    blurb: '最近大家都在看的华语电影。',
    kind: 'movie',
    tag: '华语',
  },
  {
    id: 'kdrama',
    kicker: 'K-DRAMA',
    title: '韩剧热播',
    blurb: '正在热播、口碑在涨的韩剧。',
    kind: 'tv',
    tag: '韩剧',
  },
]

/** 按标识取片单 */
export const collectionOf = (id: CollectionId): Collection =>
  COLLECTIONS.find(c => c.id === id) ?? COLLECTIONS[0]

/** 片单的查询条件（快捷标签模式） */
export const collectionQuery = (c: Collection): DoubanQuery => ({
  ...defaultDoubanQuery(c.kind),
  tag: c.tag,
})

/** 类型的查询条件（多维筛选模式，只选了类型） */
export const genreQuery = (genre: string, kind: DoubanKind): DoubanQuery =>
  normalizeDoubanQuery({ ...defaultDoubanQuery(kind), tag: '', genre })

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
