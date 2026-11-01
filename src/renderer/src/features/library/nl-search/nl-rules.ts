/**
 * 自然语言搜索的纯规则：一段输入走 AI 还是普通片名搜索、解析结果缓存、
 * 条件 → 引擎 LibraryQuery 的映射（类型名对齐本库取值）。
 *
 * 不依赖 Vue / IPC，便于测试；响应式与调用在 use-nl-search.ts。
 */
import type { LibraryQuery } from '../../../../../shared/library/ipc'
import { type LibrarySection, SECTIONS } from '../state/library-section'
import type { NlFilter } from './nl-filter'
import { type TitlePick, titlePickApplies } from './nl-title-pick'

/** 输入的去向：none 空、plain 普通片名搜索、ai 交给模型解析。 */
export type NlIntent =
  | { kind: 'none' }
  | { kind: 'plain'; text: string }
  | { kind: 'ai'; question: string; forced: boolean }

/** 强信号：出现一个就像一句描述（年代、分数、观看状态、「…的片 / 剧」等）。 */
const STRONG = [
  /\d0\s*年代|[一二三四五六七八九]十年代|\d{2,4}\s*年(以后|以前|之后|之前|后|前)/, // 年份范围的说法，copy-lint: ok
  /\d+(\.\d+)?\s*分(以上|以下|及以上)?/,
  /没看过|没看完|看过的|在看的|还没看/,
  /评分|高分|口碑|好评|豆瓣/,
  /(\d|[一二三四五六七八九十两]|小时|分钟)\s*(以上|以下|以内|之后|之前|以前|以后)/, // 年份范围的说法，copy-lint: ok
  /的.{0,8}(片|剧|电影|电视剧|动画|纪录片|作品)$/,
  /^(韩|日|美|英|泰|港|台|国产|欧美|大陆|印度)(剧|片|影)$/,
  /(主演|导演|拍的|演的)/,
  /^(最新|最近|推荐|有什么)/,
]

/** 弱信号：两个弱信号（或弱信号 + 多个词）才算描述。 */
const WEAK = [
  /的/,
  /科幻|动作|喜剧|爱情|恐怖|悬疑|犯罪|动画|纪录|战争|奇幻|惊悚|剧情|武侠|家庭|冒险/,
  /韩|日本|美国|港|台湾|国产|欧美|英国|法国|印度|泰国/,
  /(片|剧|电影)$/,
]

/** 文本像不像一句自然语言描述（而不是片名关键词）。 */
export function looksNatural(text: string): boolean {
  const t = text.trim()
  if ([...t].length < 3) return false
  let score = 0
  for (const re of STRONG) if (re.test(t)) score += 2
  for (const re of WEAK) if (re.test(t)) score += 1
  const words = t.split(/\s+/).filter(Boolean).length
  if (words >= 3) score += 2
  else if (words === 2) score += 1
  return score >= 2
}

/** 强制走 AI 的前缀（半角 / 全角问号）。 */
const FORCE_PREFIX = /^[?？]\s*/

/**
 * 判断一段输入怎么搜。
 * @param text 搜索框内容
 * @param forced 用户点了「AI 理解」按钮（只对这段文字有效）
 */
export function nlIntent(text: string, forced = false): NlIntent {
  const raw = text.trim()
  if (!raw) return { kind: 'none' }
  if (FORCE_PREFIX.test(raw)) {
    const question = raw.replace(FORCE_PREFIX, '').trim()
    return question ? { kind: 'ai', question, forced: true } : { kind: 'none' }
  }
  if (forced) return { kind: 'ai', question: raw, forced: true }
  return looksNatural(raw)
    ? { kind: 'ai', question: raw, forced: false }
    : { kind: 'plain', text: raw }
}

/** 缓存键：分区 + 规整后的问题（分区不同，可选的类型取值也不同）。 */
export function cacheKey(section: LibrarySection, question: string): string {
  return `${section}\n${question.trim().replace(/\s+/g, ' ').toLowerCase()}`
}

/** 解析结果缓存（按问题，最近用过的留下）。 */
export class NlCache<T> {
  private readonly map = new Map<string, T>()
  constructor(private readonly limit = 50) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (hit === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, hit)
    return hit
  }

  set(key: string, value: T): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value as string)
    }
  }
}

/** 常见类型说法 → TMDB 中文 / 剧集类型名（同一概念在电影和剧集里叫法不同）。 */
const GENRE_ALIASES: Record<string, string[]> = {
  科幻: ['科幻', 'Sci-Fi & Fantasy', '科幻奇幻'],
  奇幻: ['奇幻', 'Sci-Fi & Fantasy', '科幻奇幻'],
  动作: ['动作', 'Action & Adventure', '动作冒险'],
  冒险: ['冒险', 'Action & Adventure', '动作冒险'],
  战争: ['战争', 'War & Politics', '战争政治'],
  纪录: ['纪录', '纪录片'],
  纪录片: ['纪录', '纪录片'],
  动漫: ['动画'],
  爱情: ['爱情', '浪漫'],
}

/**
 * 把模型给的类型名对齐到本库实际的取值：原样命中 → 别名 → 包含关系；
 * 都对不上就原样返回（查询会是 0 条，用户能看到并删掉这个条件）。
 */
export function resolveGenre(
  genre: string,
  available: readonly string[]
): string {
  const lower = genre.toLowerCase()
  const exact = available.find(v => v.toLowerCase() === lower)
  if (exact) return exact
  for (const alias of GENRE_ALIASES[genre] ?? []) {
    const hit = available.find(v => v.toLowerCase() === alias.toLowerCase())
    if (hit) return hit
  }
  const partial = available.find(v => {
    const value = v.toLowerCase()
    return value.includes(lower) || lower.includes(value)
  })
  return partial ?? genre
}

/** 分区里的条目类型与条件里的 type 是否冲突（如电影页说「韩剧」；动漫页两种都有，不冲突）。 */
export function typeConflicts(
  section: LibrarySection,
  filter: Pick<NlFilter, 'type'>
): boolean {
  return (
    filter.type !== undefined && !SECTIONS[section].types.includes(filter.type)
  )
}

/** 映射时需要的上下文。 */
export interface NlQueryContext {
  section: LibrarySection
  /** 本分区的类型取值（facets.list tag） */
  genres: readonly string[]
  /** 看过 / 在看的条目 id（继续播放记录） */
  watchedIds: readonly number[]
  /** 按片名判断的结果（见 nl-title-pick）；类型 / 地区与条件一致、查询范围没变时替换类型 / 地区条件 */
  titlePick?: TitlePick | null
}

/** 引擎 ids / excludeIds 上限（与 MAX_FILTER_IDS 一致）。 */
const MAX_IDS = 1000

/**
 * 条件 → 引擎查询：在海报墙的基础查询（分区、匹配筛选、媒体库、排序）上叠加。
 * type 与分区冲突时忽略（条件条上会标出）；关键词替换片名搜索；
 * 有适用的按片名判断结果时，类型 / 地区条件换成挑中的 id（与「看过」的 id 取交集）。
 */
export function applyNlFilter(
  base: LibraryQuery,
  filter: NlFilter,
  ctx: NlQueryContext
): LibraryQuery {
  const query: LibraryQuery = { ...base }
  delete query.search
  const pick = titlePickApplies(ctx.titlePick, filter, base)
    ? ctx.titlePick
    : null
  if (filter.genres?.length && !pick) {
    const tags = filter.genres.map(g => resolveGenre(g, ctx.genres))
    const merged = [...new Set([...(base.facets?.tag ?? []), ...tags])]
    query.facets = { ...base.facets, tag: merged }
  }
  if (filter.yearFrom !== undefined) query.yearFrom = filter.yearFrom
  if (filter.yearTo !== undefined) query.yearTo = filter.yearTo
  if (filter.ratingMin !== undefined) query.ratingMin = filter.ratingMin
  if (filter.people?.length) query.people = [...filter.people]
  if (filter.countries?.length && !pick) query.countries = [...filter.countries]
  if (filter.watched === true) query.ids = ctx.watchedIds.slice(0, MAX_IDS)
  else if (filter.watched === false && ctx.watchedIds.length)
    query.excludeIds = ctx.watchedIds.slice(0, MAX_IDS)
  if (pick) {
    // ids 为 [] 时引擎按「白名单为空」返回 0 条（validate-filters / filter-sql），不会退化成不过滤
    const watched = query.ids && new Set(query.ids)
    const ids = watched ? pick.ids.filter(id => watched.has(id)) : pick.ids
    query.ids = ids.slice(0, MAX_IDS)
  }
  if (filter.sort) {
    query.sort = filter.sort.field
    query.order = filter.sort.order
  }
  const keyword = filter.keywords?.[0]
  if (keyword) query.search = keyword
  return query
}

/** 私密分区（番号）：请求带 private，设置要求时只发给本地模型。 */
export const isPrivateSection = (section: LibrarySection): boolean =>
  section === 'jav'
