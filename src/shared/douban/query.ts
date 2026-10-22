/**
 * 豆瓣浏览的查询条件：渲染层筛选面板、IPC 契约校验、引擎拼请求共用这一份白名单。
 *
 * 两种取数方式（引擎按条件自动选，见 engine/online/douban-browse.ts）：
 * - 快捷标签（热门、最新、华语…）：movie.douban.com/j/search_subjects，tag 单选；
 * - 多维筛选（类型 × 地区 × 年代 × 排序 × 评分下限）：m.douban.com/rexxar/api/v2/<movie|tv>/recommend。
 * 筛选全为默认值时就是快捷标签模式；动了任一筛选，快捷标签清空。
 *
 * 本文件被契约（preload 打包）引用：纯 TS，不 import 任何模块。
 */

/** 条目类型 */
export type DoubanKind = 'movie' | 'tv'

/** 排序：U 综合、T 近期热度、R 上映时间、S 评分（rexxar 的 sort 参数） */
export type DoubanSort = 'U' | 'T' | 'R' | 'S'

/** 一次浏览的条件 */
export interface DoubanQuery {
  kind: DoubanKind
  /** 快捷标签；动了多维筛选时为空 */
  tag: string
  /** 类型（剧情、喜剧…）；空 = 全部 */
  genre: string
  /** 地区；空 = 全部 */
  region: string
  /** 年代：某一年「2025」、某个年代「2010年代」或「更早」；空 = 全部 */
  era: string
  sort: DoubanSort
  /** 评分下限，0 = 不限 */
  minRating: number
}

/** 一张豆瓣卡（引擎映射后的统一形状） */
export interface DoubanSubject {
  /** 豆瓣条目 ID（数字串） */
  id: string
  title: string
  /** 豆瓣封面地址（doubanio.com，Referer 由主进程补） */
  cover: string
  /** 评分文字，如「8.6」；无评分为空 */
  rate: string
  /** movie.douban.com/subject/<id>/ */
  url: string
  /** 年份；快捷标签接口不给，为空 */
  year: string
  kind: DoubanKind
}

/** 一页结果 */
export interface DoubanPage {
  items: DoubanSubject[]
  /** 下一页的 start；没有更多为 null */
  next: number | null
}

/** 每页条数（两个接口都取 20） */
export const DOUBAN_PAGE_SIZE = 20
/** start 上限：豆瓣探索接口翻到 500 左右就不再给数据，留余量防止死循环翻页 */
export const DOUBAN_MAX_START = 1000

/** 快捷标签（与改版前的分类一致） */
export const QUICK_TAGS: Record<DoubanKind, readonly string[]> = {
  movie: [
    '热门',
    '最新',
    '经典',
    '豆瓣高分',
    '冷门佳片',
    '华语',
    '欧美',
    '韩国',
    '日本',
    '动作',
    '喜剧',
    '爱情',
    '科幻',
    '悬疑',
    '恐怖',
  ],
  tv: [
    '热门',
    '美剧',
    '英剧',
    '韩剧',
    '日剧',
    '国产剧',
    '港剧',
    '日本动画',
    '综艺',
    '纪录片',
  ],
}

/** 类型（取豆瓣「选电影 / 选剧集」页的常用项） */
export const GENRES: Record<DoubanKind, readonly string[]> = {
  movie: [
    '剧情',
    '喜剧',
    '动作',
    '爱情',
    '科幻',
    '动画',
    '悬疑',
    '犯罪',
    '惊悚',
    '冒险',
    '奇幻',
    '恐怖',
    '战争',
    '历史',
    '传记',
    '纪录片',
  ],
  tv: [
    '剧情',
    '喜剧',
    '爱情',
    '悬疑',
    '古装',
    '家庭',
    '犯罪',
    '科幻',
    '武侠',
    '动作',
    '动画',
    '历史',
  ],
}

/** 地区 */
export const REGIONS: Record<DoubanKind, readonly string[]> = {
  movie: [
    '华语',
    '欧美',
    '韩国',
    '日本',
    '中国大陆',
    '中国香港',
    '中国台湾',
    '美国',
    '英国',
    '法国',
    '德国',
    '意大利',
    '印度',
    '泰国',
  ],
  tv: [
    '华语',
    '欧美',
    '韩国',
    '日本',
    '中国大陆',
    '中国香港',
    '中国台湾',
    '美国',
    '英国',
    '泰国',
  ],
}

/** 年代档（年份档由 eraOptions 按当前年份生成） */
export const DECADES = [
  '2020年代',
  '2010年代',
  '2000年代',
  '90年代',
  '80年代',
  '更早',
] as const

/** 排序选项 */
export const SORTS: ReadonlyArray<{ value: DoubanSort; label: string }> = [
  { value: 'U', label: '综合' },
  { value: 'T', label: '近期热度' },
  { value: 'R', label: '上映时间' },
  { value: 'S', label: '评分' },
]

/** 评分下限选项 */
export const MIN_RATINGS = [0, 6, 7, 8, 9] as const

/** 默认条件：电影 · 热门 */
export function defaultDoubanQuery(kind: DoubanKind = 'movie'): DoubanQuery {
  return {
    kind,
    tag: '热门',
    genre: '',
    region: '',
    era: '',
    sort: 'U',
    minRating: 0,
  }
}

/** 年代选项：今年、去年，再接各年代档 */
export function eraOptions(year: number): string[] {
  return [String(year), String(year - 1), ...DECADES]
}

/** 是否动了多维筛选（动了就走 rexxar 探索接口） */
export function hasFilters(query: DoubanQuery): boolean {
  return (
    !!query.genre ||
    !!query.region ||
    !!query.era ||
    query.sort !== 'U' ||
    query.minRating > 0
  )
}

const isEra = (value: string): boolean =>
  (DECADES as readonly string[]).includes(value) ||
  (/^\d{4}$/.test(value) && +value >= 1900 && +value <= 2100)

const pick = (value: unknown, allowed: readonly string[]): string =>
  typeof value === 'string' && allowed.includes(value) ? value : ''

/**
 * 把任意输入收成合法条件：不认识的字段值丢成默认（白名单）。
 * 动了筛选时快捷标签清空；什么都没选时回到「热门」。
 */
export function normalizeDoubanQuery(raw: unknown): DoubanQuery {
  const input =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const kind: DoubanKind = input.kind === 'tv' ? 'tv' : 'movie'
  const sort = SORTS.find(s => s.value === input.sort)?.value ?? 'U'
  const rating = Number(input.minRating)
  const query: DoubanQuery = {
    kind,
    tag: pick(input.tag, QUICK_TAGS[kind]),
    genre: pick(input.genre, GENRES[kind]),
    region: pick(input.region, REGIONS[kind]),
    era: typeof input.era === 'string' && isEra(input.era) ? input.era : '',
    sort,
    minRating: (MIN_RATINGS as readonly number[]).includes(rating) ? rating : 0,
  }
  if (hasFilters(query)) query.tag = ''
  else if (!query.tag) query.tag = '热门'
  return query
}

/** 合法的 start：0 ≤ start ≤ DOUBAN_MAX_START 的整数，否则 null */
export function parseDoubanStart(raw: unknown): number | null {
  return typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= 0 &&
    raw <= DOUBAN_MAX_START
    ? raw
    : null
}
