/**
 * 追剧日历的纯规则：把媒体库的播出数据和「继续播放」里的在线剧整理成日历条目，
 * 判定每张卡的状态（已看 / 未看 / 待播），算侧栏徽标上的未看新集数，分出列表视图的分组。
 *
 * 不依赖 Vue、存储和播放器：调用方把播放记录、文件进度以普通数据传进来。日期规则在 calendar-dates.ts。
 */
import type { CalendarEpisode } from '../../../../shared/library/ipc'
import { WATCHED_RATIO } from '../../../../shared/library/watch-progress'
import {
  addDays,
  dayLabel,
  daysBetween,
  weekDays,
  weekPrefix,
} from './calendar-dates'

/** 卡片状态。 */
export type EpisodeStatus = 'watched' | 'unwatched' | 'upcoming'

/** 状态文案。 */
export const STATUS_LABEL: Record<EpisodeStatus, string> = {
  watched: '已看',
  unwatched: '未看',
  upcoming: '待播',
}

/** 徽标只数最近几天（含今天）播出的未看集。 */
export const BADGE_DAYS = 7
/** 播到这个比例算看完（与片库观看进度、「继续播放」同一个阈值）。 */
export { WATCHED_RATIO }

/** 一张日历卡。 */
export interface CalendarEntry {
  /** 列表里唯一 */
  id: string
  source: 'library' | 'online'
  /** 剧名 */
  title: string
  /** 集号：S01E03 / E05 / E05–06 */
  code: string
  episodeTitle: string | null
  /** 播出日期 YYYY-MM-DD；在线剧拿不到更新日期时为 null */
  airDate: string | null
  /** 背景图原始地址；imageKind 说明怎么换成界面地址 */
  image: string | null
  /** library：媒体库的图（缓存图 / TMDB 远程）；remote：普通远程图片 */
  imageKind: 'library' | 'remote'
  status: EpisodeStatus
  /** 计入徽标的未看新集数 */
  newCount: number
  /** 媒体库条目：点卡片播放或打开详情 */
  library?: {
    seriesId: number
    season: number
    episode: number
    /** 本地有视频文件 */
    playable: boolean
  }
  /** 在线条目：点卡片打开详情 */
  online?: { recordId: string; detail: unknown }
}

/** 「继续播放」记录里用到的字段（结构与 ContinueRecord 一致，这里只声明读的部分）。 */
export interface ContinueLike {
  id: string
  section: string
  key: string
  title: string
  cover?: string
  detail?: unknown
  replay: { playlist?: Array<{ name?: string }>; index?: number }
  nextUp?: boolean
}

/** 一个文件的播放进度（秒）；finished 为播放器记下的独立「已看完」标记。 */
export interface ProgressLike {
  progress: number
  duration: number
  finished?: boolean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 季集号：S01E03。 */
export const episodeCode = (season: number, episode: number): string =>
  `S${pad2(season)}E${pad2(episode)}`

/** 从集名里认出季集号（播放列表的集名形如「S01E05 · 标题」）。 */
export function parseEpisodeCode(
  name: string | undefined
): { season: number; episode: number } | null {
  const m = /S(\d{1,3})\s*E(\d{1,4})/i.exec(name ?? '')
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null
}

/** 判定状态：播出日期在今天之后为待播，否则按是否看过。 */
export function episodeStatus(
  airDate: string | null,
  today: string,
  watched: boolean
): EpisodeStatus {
  if (airDate !== null && airDate > today) return 'upcoming'
  return watched ? 'watched' : 'unwatched'
}

/** 进度是否算看完：有「已看完」标记，或进度过了 95%（总时长未知不算）。 */
export const progressFinished = (p: ProgressLike | null | undefined): boolean =>
  !!p &&
  (p.finished === true ||
    (p.duration > 0 && p.progress >= p.duration * WATCHED_RATIO))

/**
 * 媒体库的一集看过没有：
 * - 这个文件在「已看完」集合里（播放器看完时记录，续播点清零、继续播放记录删掉后仍在）；或
 * - 这个文件的播放进度过了 90%；或
 * - 这部剧的「继续播放」记录里，这一集排在当前集之前（看完一集记录会前进到下一集）。
 */
export function libraryEpisodeWatched(
  ep: Pick<CalendarEpisode, 'season' | 'episode'>,
  record: ContinueLike | undefined,
  progress: ProgressLike | null
): boolean {
  if (progressFinished(progress)) return true
  const playlist = record?.replay.playlist ?? []
  const current = record?.replay.index ?? 0
  const pos = playlist.findIndex(entry => {
    const code = parseEpisodeCode(entry.name)
    return code?.season === ep.season && code.episode === ep.episode
  })
  return pos >= 0 && pos < current
}

/** 媒体库播出数据 → 日历卡。 */
export function libraryEntries(
  episodes: readonly CalendarEpisode[],
  today: string,
  records: readonly ContinueLike[],
  progressOf: (ep: CalendarEpisode) => ProgressLike | null
): CalendarEntry[] {
  const bySeries = new Map(
    records.filter(r => r.section === 'tv').map(r => [r.key, r])
  )
  return episodes.map(ep => {
    const watched = libraryEpisodeWatched(
      ep,
      bySeries.get(String(ep.seriesId)),
      progressOf(ep)
    )
    const status = episodeStatus(ep.airDate, today, watched)
    return {
      id: `lib:${ep.seriesId}:${ep.season}:${ep.episode}`,
      source: 'library',
      title: ep.seriesTitle,
      code: episodeCode(ep.season, ep.episode),
      episodeTitle: ep.title,
      airDate: ep.airDate,
      image: ep.still ?? ep.backdrop,
      imageKind: ep.still ? 'remote' : 'library',
      status,
      newCount: status === 'unwatched' ? 1 : 0,
      library: {
        seriesId: ep.seriesId,
        season: ep.season,
        episode: ep.episode,
        playable: ep.fileId !== null,
      },
    }
  })
}

/** CMS 备注（vod_remarks）里的集数与是否完结。 */
export function parseRemarks(remarks: unknown): {
  count: number | null
  complete: boolean
} {
  const text = typeof remarks === 'string' ? remarks.trim() : ''
  const complete = /完结|全集|全\s*\d+\s*[集话話]|\d+\s*[集话話]\s*全/.test(
    text
  )
  const patterns = [
    /全\s*(\d+)\s*[集话話]/,
    /(\d+)\s*[集话話]\s*全/,
    /(?:更新|更至)\s*(?:至|到)?\s*(?:第\s*)?(?:EP?\s*)?(\d+)/i,
    /第\s*(\d+)\s*[集话話]/,
    /(\d+)\s*[集话話]/,
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return { count: Number(m[1]), complete }
  }
  return { count: null, complete }
}

/** CMS 的更新时间（vod_time，形如 2026-10-22 10:12:33）→ 日期键；没有或不合法为 null。 */
export function onlineUpdateDate(detail: unknown): string | null {
  const raw =
    detail && typeof detail === 'object'
      ? (detail as Record<string, unknown>).vod_time
      : undefined
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof raw === 'string' ? raw : '')
  return m ? m[1] : null
}

/**
 * 「继续播放」里的在线剧 → 日历卡（只用开播时存下的豆瓣 / CMS 数据，不另外联网）：
 * 已更新集数 = max(备注里的集数, 当时的播放列表长度)；看到第几集 = 当前集（还没开看的「下一集」不算）；
 * 两者之差就是没看的新集。单集（电影）跳过。
 */
export function onlineEntries(
  records: readonly ContinueLike[],
  today: string
): CalendarEntry[] {
  const out: CalendarEntry[] = []
  for (const r of records) {
    if (r.section !== 'online') continue
    const detail = (r.detail ?? {}) as Record<string, unknown>
    const remarks = parseRemarks(detail.vod_remarks)
    const listed = r.replay.playlist?.length ?? 0
    const available = Math.max(remarks.count ?? 0, listed)
    if (available <= 1) continue
    const index = r.replay.index ?? 0
    const seen = Math.min(r.nextUp ? index : index + 1, available)
    const newCount = Math.max(0, available - seen)
    const airDate = onlineUpdateDate(detail)
    const first = seen + 1
    const code = !newCount
      ? `E${pad2(available)}`
      : first === available
        ? `E${pad2(first)}`
        : `E${pad2(first)}–${pad2(available)}`
    const status = episodeStatus(airDate, today, newCount === 0)
    out.push({
      id: r.id,
      source: 'online',
      title: r.title,
      code,
      episodeTitle: newCount ? `${newCount} 集未看` : null,
      airDate,
      image:
        r.cover ?? (typeof detail.vod_pic === 'string' ? detail.vod_pic : null),
      imageKind: 'remote',
      status,
      // 已完结的剧没有「新集」，只在卡片上显示未看
      newCount: status === 'unwatched' && !remarks.complete ? newCount : 0,
      online: { recordId: r.id, detail: r.detail },
    })
  }
  return out
}

/** 卡片排序：日期（没有日期的排最后）→ 剧名 → 集号。 */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if (a.airDate !== b.airDate) {
    if (a.airDate === null) return 1
    if (b.airDate === null) return -1
    return a.airDate.localeCompare(b.airDate)
  }
  return (
    a.title.localeCompare(b.title, 'zh-Hans-CN') ||
    a.code.localeCompare(b.code, undefined, { numeric: true })
  )
}

/**
 * 侧栏徽标：最近 BADGE_DAYS 天（含今天）播出、还没看的新集数之和；
 * 没有更新日期的在线剧（连载中）也算。
 */
export function badgeCount(
  entries: readonly CalendarEntry[],
  today: string
): number {
  let total = 0
  for (const e of entries) {
    if (e.status !== 'unwatched' || !e.newCount) continue
    if (e.airDate === null) {
      total += e.newCount
      continue
    }
    const age = daysBetween(e.airDate, today)
    if (age >= 0 && age < BADGE_DAYS) total += e.newCount
  }
  return total
}

/** 徽标统计要查的媒体库日期区间。 */
export function badgeRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -(BADGE_DAYS - 1)), to: today }
}

/** 列表视图的一组。 */
export interface ListGroup {
  key: string
  label: string
  isToday: boolean
  items: CalendarEntry[]
}

/** 列表视图：这一周有条目的日子按日期排，没有日期的在线剧另成一组放最后。 */
export function listGroups(
  entries: readonly CalendarEntry[],
  start: string,
  today: string
): ListGroup[] {
  const days = new Set(weekDays(start))
  const sorted = [...entries].sort(compareEntries)
  const groups = new Map<string, ListGroup>()
  for (const e of sorted) {
    if (e.airDate !== null && !days.has(e.airDate)) continue
    const key = e.airDate ?? 'undated'
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: e.airDate
          ? dayLabel(e.airDate, today)
          : '在线追剧 · 更新日期未知',
        isToday: e.airDate === today,
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(e)
  }
  return [...groups.values()]
}

/**
 * 条目所属剧的去重键：媒体库按 seriesId、在线剧按继续播放记录 id，两者都没有才退回剧名。
 * 同名的不同剧（翻拍、同名综艺）因此不会被合并成一部。
 */
export function showKey(entry: CalendarEntry): string {
  if (entry.library) return `library:${entry.library.seriesId}`
  if (entry.online) return `online:${entry.online.recordId}`
  return `title:${entry.title}`
}

/**
 * 页头说明：显示中的那一周有几部剧、几集更新，如「下周 3 部剧 · 5 集更新」；没有条目时为空串。
 * @param items 这一周的条目
 * @param start 这一周的周一
 * @param today 今天的日期键
 */
export function weekSummary(
  items: readonly CalendarEntry[],
  start: string,
  today: string
): string {
  if (!items.length) return ''
  const shows = new Set(items.map(showKey)).size
  return `${weekPrefix(start, today)} ${shows} 部剧 · ${items.length} 集更新`
}

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
