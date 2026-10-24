/**
 * 「想看」清单的纯规则：条目的形状、加入 / 移除 / 切换、每个板块取哪些、读回存储时的校验。
 *
 * 条目 id 与「继续播放」记录同一套（section:key），整部看完时按 id 从清单里移除。
 * 不依赖 Vue 和 localStorage，存取在 watchlist-store.ts，界面在 WatchlistRow.vue / WatchlistButton.vue。
 */
import type { ContinueSection } from '@/features/player'

/** 板块：与「继续播放」相同（在线首页、电影页、电视剧页等顶部各列自己的）。 */
export type WatchlistSection = ContinueSection

/** 详情页加入想看时给出的条目信息。 */
export interface WatchlistMeta {
  section: WatchlistSection
  /** 板块内唯一，与开播时 continueAs.key 一致（在线是片名，媒体库是条目 id） */
  key: string
  title: string
  /** 竖版海报（横排卡片用） */
  poster?: string
  /** 横版封面（海报缺失时退回） */
  cover?: string
  /** 「打开详情」时交回页面的数据（媒体库是 { itemId }，在线是详情条目）；须可 JSON 序列化 */
  detail?: unknown
}

/** 清单里的一条。 */
export interface WatchlistEntry extends WatchlistMeta {
  /** section + key */
  id: string
  addedAt: number
}

/** 最多保留几条（所有板块合计）。 */
export const WATCHLIST_LIMIT = 200
/** 每个板块顶部横排最多显示几张；更多的点「查看全部」展开成完整列表。 */
export const WATCHLIST_ROW_LIMIT = 30

export const watchlistId = (section: WatchlistSection, key: string): string =>
  `${section}:${key}`

/** 是否已在清单里。 */
export function hasEntry(
  entries: readonly WatchlistEntry[],
  section: WatchlistSection,
  key: string
): boolean {
  const id = watchlistId(section, key)
  return entries.some(entry => entry.id === id)
}

/** 加入（已在清单里时更新信息并移到最前），超过上限丢最早加入的。 */
export function addEntry(
  entries: readonly WatchlistEntry[],
  meta: WatchlistMeta,
  now: number
): WatchlistEntry[] {
  const id = watchlistId(meta.section, meta.key)
  return [
    { ...meta, id, addedAt: now },
    ...entries.filter(entry => entry.id !== id),
  ].slice(0, WATCHLIST_LIMIT)
}

/** 按 id 移除；没有这条时原样返回（同一个数组，调用方可据此跳过写入）。 */
export function removeEntry(
  entries: WatchlistEntry[],
  id: string
): WatchlistEntry[] {
  return entries.some(entry => entry.id === id)
    ? entries.filter(entry => entry.id !== id)
    : entries
}

/** 切换：在清单里就移除，不在就加入。 */
export function toggleEntry(
  entries: WatchlistEntry[],
  meta: WatchlistMeta,
  now: number
): WatchlistEntry[] {
  return hasEntry(entries, meta.section, meta.key)
    ? removeEntry(entries, watchlistId(meta.section, meta.key))
    : addEntry(entries, meta, now)
}

/** 某板块的全部条目（最近加入的在前）。 */
export function entriesFor(
  entries: readonly WatchlistEntry[],
  section: WatchlistSection
): WatchlistEntry[] {
  return entries.filter(entry => entry.section === section)
}

/** 横排实际渲染的条目：收起时取前 WATCHLIST_ROW_LIMIT 条，展开（查看全部）时全部。 */
export function visibleEntries(
  all: readonly WatchlistEntry[],
  expanded: boolean
): readonly WatchlistEntry[] {
  return expanded ? all : all.slice(0, WATCHLIST_ROW_LIMIT)
}

/** 收起时横排之外还有几条（「查看全部」入口上显示）。 */
export const hiddenCount = (all: readonly WatchlistEntry[]): number =>
  Math.max(0, all.length - WATCHLIST_ROW_LIMIT)

/** 卡片用的图：海报优先，没有就用横版封面。 */
export const entryImage = (entry: WatchlistEntry): string =>
  entry.poster || entry.cover || ''

/** 读回存储时校验：形状不对的丢掉，同 id 只留第一条。 */
export function sanitizeEntries(raw: unknown): WatchlistEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .filter((entry): entry is WatchlistEntry => {
      const ok =
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.section === 'string' &&
        typeof entry.key === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.addedAt === 'number' &&
        !seen.has(entry.id)
      if (ok) seen.add(entry.id)
      return ok
    })
    .slice(0, WATCHLIST_LIMIT)
}
