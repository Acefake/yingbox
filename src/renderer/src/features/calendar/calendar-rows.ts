/**
 * 追剧日历的行规则：同一天同一部剧的几集合并成一行（周视图、列表视图共用），算合并后的集号区间与状态。
 * 不依赖 Vue；条目规则在 calendar-rules.ts。
 */
import {
  type CalendarEntry,
  type EpisodeStatus,
  compareEntries,
  showKey,
} from './calendar-rules'

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 同一天同一部剧合并成的一行。 */
export interface ShowDayGroup {
  /** 列表里唯一：日期 + 剧 */
  id: string
  title: string
  /** 合并后的集号：S01E09 / S01E09–E10 / S01E09 等 3 集 */
  code: string
  /** 只有一集时的集名 */
  episodeTitle: string | null
  image: string | null
  imageKind: CalendarEntry['imageKind']
  /** 有未看的集就是未看；全是待播才是待播；其余已看 */
  status: EpisodeStatus
  /** 按日期、剧名、集号排好的各集 */
  entries: CalendarEntry[]
  /** 点这一行时打开的那一集：第一集未看的，没有就第一集 */
  primary: CalendarEntry
}

/**
 * 合并后的集号：一集原样；同一季、集号连续写成 S01E09–E10；其余写成「第一集 等 N 集」。
 * 在线剧的集号本身已是区间（E05–06），同一天同一部只会有一条。
 */
export function mergedCode(entries: readonly CalendarEntry[]): string {
  if (entries.length === 1) return entries[0].code
  const first = entries[0]
  const last = entries[entries.length - 1]
  const eps = entries.map(e => e.library)
  const contiguous =
    eps.every(ep => ep && ep.season === eps[0]!.season) &&
    eps.every((ep, i) => i === 0 || ep!.episode === eps[i - 1]!.episode + 1)
  if (contiguous) return `${first.code}–E${pad2(last.library!.episode)}`
  return `${first.code} 等 ${entries.length} 集`
}

/**
 * 同一天里同一部剧（showKey 相同）的集合并成一行，保持第一次出现的先后；
 * 每组内部按 compareEntries 排（集号从小到大）。日期不同的条目不要一起传进来。
 */
export function groupShowsByDay(
  entries: readonly CalendarEntry[]
): ShowDayGroup[] {
  const groups = new Map<string, CalendarEntry[]>()
  for (const e of entries) {
    const key = `${e.airDate ?? 'undated'}|${showKey(e)}`
    const list = groups.get(key)
    if (list) list.push(e)
    else groups.set(key, [e])
  }
  return [...groups].map(([id, list]) => {
    const sorted = [...list].sort(compareEntries)
    const first = sorted[0]
    const status: EpisodeStatus = sorted.some(e => e.status === 'unwatched')
      ? 'unwatched'
      : sorted.every(e => e.status === 'upcoming')
        ? 'upcoming'
        : 'watched'
    return {
      id,
      title: first.title,
      code: mergedCode(sorted),
      episodeTitle: sorted.length === 1 ? first.episodeTitle : null,
      image: sorted.find(e => e.image)?.image ?? null,
      imageKind: (sorted.find(e => e.image) ?? first).imageKind,
      status,
      entries: sorted,
      primary: sorted.find(e => e.status === 'unwatched') ?? first,
    }
  })
}
