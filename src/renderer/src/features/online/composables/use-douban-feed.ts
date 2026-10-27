/**
 * 豆瓣浏览的状态：当前条件、已加载的卡、分页状态、离开时的滚动位置。
 *
 * - 分页：start 由引擎给的 next 决定；加载中 / 到底 / 失败时 loadMore 不发请求，失败后由 retry 从失败那页接着取。
 * - 去重：按条目地址，跨页重复的只留第一次；一整页都是重复（或被评分下限筛空）时自动接着取下一页，最多连取 3 页。
 * - 换条件：从 start=0 重取；新一批到达前保留旧卡（不清空、不跳滚动，见 components/ui/feedback.ts），
 *   旧条件晚到的结果按代号丢弃。
 * - 记住条件：会话级。条件存 sessionStorage（窗口刷新后还在，重启应用回到默认「热门」——筛选是浏览状态，
 *   不是偏好设置，所以不进 settings schema）；条件、卡片、滚动位置同时放在模块级单例里，
 *   在线页被 keep-alive 切走或组件重建都不丢，回来直接显示原来的列表。
 */
import { type Ref, ref } from 'vue'

import {
  type DoubanPage,
  type DoubanQuery,
  type DoubanSubject,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../../../../../shared/douban/query'
import { doubanBrowse } from '../api/online'
import type { DoubanItem } from '../types'
import { enrichFromTmdb } from '../utils/douban-tmdb'

/** idle 还没取过；loading 取数中；ready 还有下一页；ended 到底；error 上一次失败 */
export type DoubanFeedStatus = 'idle' | 'loading' | 'ready' | 'ended' | 'error'

/** 豆瓣浏览状态 */
export interface DoubanFeed {
  /** 当前条件（只读用；改用 setQuery） */
  query: Ref<DoubanQuery>
  items: Ref<DoubanItem[]>
  status: Ref<DoubanFeedStatus>
  /** 换条件后、新一批到达前（旧卡还在，页面淡显旧卡） */
  refreshing: Ref<boolean>
  /** 在线页切走时记下的滚动位置（px） */
  scrollTop: number
  /** 首次进入：还没取过就取第一页 */
  start(): Promise<void>
  /** 取下一页（列表到底时调用） */
  loadMore(): Promise<void>
  /** 失败后重试失败的那页 */
  retry(): Promise<void>
  /** 按当前条件从头重取 */
  reload(): Promise<void>
  /** 改条件（只给要改的字段）；条件没变不重取 */
  setQuery(patch: Partial<DoubanQuery>): Promise<void>
  /** 整个换成另一组条件（浏览页进入某个类型 / 片单）；条件没变不重取 */
  replaceQuery(query: DoubanQuery): Promise<void>
}

/** 依赖（测试替换） */
export interface DoubanFeedDeps {
  browse: (query: DoubanQuery, start: number) => Promise<DoubanPage>
  /** 新到的一批卡的补全（默认 TMDB 补海报）；不等它完成 */
  enrich?: (items: DoubanItem[], kind: DoubanQuery['kind']) => unknown
  /** 记住条件的存储；null 不记 */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** 初始条件（存储里没有时）；默认电影 · 热门 */
  initial?: DoubanQuery
}

/** sessionStorage 里条件的键 */
const QUERY_KEY = 'douban_query'
/** 一次 loadMore 因整页重复最多连取的页数 */
const MAX_EMPTY_PAGES = 3

/** 引擎给的豆瓣卡 → 页面用的豆瓣条目（封面等 TMDB 补全后再填） */
export const doubanItemOf = (s: DoubanSubject): DoubanItem => ({
  title: s.title,
  searchTitle: s.title,
  original_title: '',
  cover: '',
  coverSrc: s.cover,
  rate: s.rate || '暂无',
  url: s.url,
  year: s.year,
  type: '',
  overview: '',
  kind: s.kind,
})

function readQuery(
  storage: DoubanFeedDeps['storage'],
  initial: DoubanQuery
): DoubanQuery {
  try {
    const saved = storage?.getItem(QUERY_KEY)
    return saved ? normalizeDoubanQuery(JSON.parse(saved)) : initial
  } catch {
    return initial
  }
}

/** 创建一份豆瓣浏览状态 */
export function createDoubanFeed(deps: DoubanFeedDeps): DoubanFeed {
  const storage = deps.storage ?? null
  const query = ref<DoubanQuery>(
    readQuery(
      storage,
      normalizeDoubanQuery(deps.initial ?? defaultDoubanQuery())
    )
  )
  const items = ref<DoubanItem[]>([])
  const status = ref<DoubanFeedStatus>('idle')
  const refreshing = ref(false)
  /** 下一页的 start；null 到底 */
  let next: number | null = 0
  /** 已有条目地址（去重） */
  let seen = new Set<string>()
  /** 条件代号：换条件后旧请求的结果作废 */
  let generation = 0

  /** 取 next 那页；fresh 为真时整批替换（换条件后的第一页） */
  async function fetchFrom(fresh: boolean): Promise<void> {
    const gen = generation
    const q = query.value
    status.value = 'loading'
    refreshing.value = fresh && items.value.length > 0
    try {
      for (let tries = 0; tries < MAX_EMPTY_PAGES; tries++) {
        const page = await deps.browse(q, next ?? 0)
        if (gen !== generation) return
        if (fresh) {
          seen = new Set()
          items.value = []
          fresh = false
        }
        const added = page.items
          .filter(s => !seen.has(s.url) && seen.add(s.url))
          .map(doubanItemOf)
        next = page.next
        if (added.length) {
          items.value.push(...added)
          // 补全改的是响应式数组里的元素
          void deps.enrich?.(items.value.slice(-added.length), q.kind)
          break
        }
        if (next === null) break
      }
      status.value = next === null ? 'ended' : 'ready'
    } catch (error) {
      console.warn('[douban] 浏览失败', error)
      if (gen === generation) status.value = 'error'
    } finally {
      if (gen === generation) refreshing.value = false
    }
  }

  /** 换成 nextQuery 并记住；条件没变（且取过）不重取 */
  function apply(nextQuery: DoubanQuery): Promise<void> {
    if (
      JSON.stringify(nextQuery) === JSON.stringify(query.value) &&
      status.value !== 'idle'
    )
      return Promise.resolve()
    query.value = nextQuery
    try {
      storage?.setItem(QUERY_KEY, JSON.stringify(nextQuery))
    } catch {
      // 存不下就只在本次会话内存里
    }
    return restart()
  }

  function restart(): Promise<void> {
    generation++
    next = 0
    return fetchFrom(true)
  }

  return {
    query,
    items,
    status,
    refreshing,
    scrollTop: 0,
    start: () => (status.value === 'idle' ? restart() : Promise.resolve()),
    loadMore: () =>
      status.value === 'ready' ? fetchFrom(false) : Promise.resolve(),
    retry: () =>
      status.value === 'error'
        ? next === 0 || !items.value.length
          ? restart()
          : fetchFrom(false)
        : Promise.resolve(),
    reload: restart,
    setQuery(patch) {
      const merged =
        patch.kind && patch.kind !== query.value.kind
          ? { ...defaultDoubanQuery(patch.kind), ...patch }
          : // 点快捷标签：清空多维筛选
            patch.tag
            ? { ...defaultDoubanQuery(query.value.kind), tag: patch.tag }
            : { ...query.value, ...patch }
      return apply(normalizeDoubanQuery(merged))
    },
    replaceQuery: next => apply(normalizeDoubanQuery(next)),
  }
}

const sessionStore = (): DoubanFeedDeps['storage'] =>
  typeof sessionStorage === 'undefined' ? null : sessionStorage

let shared: DoubanFeed | null = null

/** 全窗口共用的一份（在线页切走再回来、组件重建都还在） */
export function useDoubanFeed(): DoubanFeed {
  return (shared ??= createDoubanFeed({
    browse: doubanBrowse,
    enrich: enrichFromTmdb,
    storage: sessionStore(),
  }))
}
