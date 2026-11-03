/**
 * 首页「按类型浏览」与「精选片单」的定义，以及它们对应的豆瓣查询条件。
 * 渲染层首页与服务端视图（view.home，ADR-0030）共用。
 */
import {
  type DoubanKind,
  type DoubanQuery,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from './query'

/** 精选片单的标识 */
export type CollectionId = 'top' | 'gems' | 'chinese' | 'kdrama'

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
