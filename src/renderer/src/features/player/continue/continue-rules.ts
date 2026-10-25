/**
 * 「继续播放」的纯规则：记录的形状、开播 / 进度 / 看完时怎么改记录、每个板块取哪些、卡片上的文案。
 *
 * 不依赖 Vue 和 localStorage，存取在 continue-store.ts，界面在 ContinueRow.vue。
 */
import { WATCHED_RATIO } from '../../../../../shared/library/watch-progress'
import type { PlaylistEntry } from '../utils/play-queue'

/** 板块：媒体库三个分区 + 在线 + AV；每个板块顶部只列自己的记录。 */
export type ContinueSection = 'movie' | 'tv' | 'jav' | 'online' | 'av'

/** 重新打开播放器所需的载荷（openMediaPlayer 的参数子集，可 JSON 序列化）。 */
export interface ContinueReplay {
  url?: string
  filePath?: string
  playlist?: PlaylistEntry[]
  index?: number
  fallbacks?: PlaylistEntry[]
}

/** 调用方开播时声明「这是哪一条」：openMediaPlayer({ continueAs }) */
export interface ContinueMeta {
  section: ContinueSection
  /** 板块内唯一：媒体库条目 id、在线 / AV 的来源 + vod_id 等 */
  key: string
  /** 条目名（剧集写剧名，集名另记在 episode） */
  title: string
  /** 横版封面（剧照 / 背景图优先，没有就用海报） */
  cover?: string
  /** 「打开详情」时交回页面的数据（媒体库是 { itemId }，在线是详情条目）；须可 JSON 序列化 */
  detail?: unknown
  /** 播放列表只是作品的一部分（如多季剧里后面还有季）：播完照样删记录，但不算整部看完 */
  partial?: boolean
}

/** 一条继续播放记录。 */
export interface ContinueRecord extends ContinueMeta {
  /** section + key */
  id: string
  replay: ContinueReplay
  /** 当前集名（多集时） */
  episode?: string
  /** 已播秒数 */
  progress: number
  /** 总时长秒数；未知为 0 */
  duration: number
  /** 上一集看完、下一集还没开始 */
  nextUp?: boolean
  updatedAt: number
}

/** 最多保留几条（所有板块合计）。 */
export const CONTINUE_LIMIT = 40
/** 每个板块顶部最多显示几张。 */
export const CONTINUE_ROW_LIMIT = 12
/** 播到这个比例算看完（与片库的观看进度同一个阈值）。 */
export const FINISHED_RATIO = WATCHED_RATIO
/** 播放不到这么多秒不算开始看（误点进来马上关掉不记）。 */
export const MIN_PROGRESS = 10

export const recordId = (section: ContinueSection, key: string): string =>
  `${section}:${key}`

/** 是否算看完（总时长未知时不判断）。 */
export function isFinished(progress: number, duration: number): boolean {
  return duration > 0 && progress >= duration * FINISHED_RATIO
}

/** 按更新时间倒序插入 / 替换，超过上限丢最旧的。 */
function put(
  records: ContinueRecord[],
  record: ContinueRecord
): ContinueRecord[] {
  return [record, ...records.filter(r => r.id !== record.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CONTINUE_LIMIT)
}

/**
 * 开播：建记录或更新已有记录的载荷与封面。进度沿用旧记录（同一集），换了集则从 startAt 开始。
 */
export function startRecord(
  records: ContinueRecord[],
  meta: ContinueMeta,
  replay: ContinueReplay,
  startAt: number,
  now: number
): ContinueRecord[] {
  const id = recordId(meta.section, meta.key)
  const old = records.find(r => r.id === id)
  const sameEpisode = !!old && (old.replay.index ?? 0) === (replay.index ?? 0)
  const playlist = replay.playlist ?? []
  return put(records, {
    ...meta,
    id,
    replay,
    episode:
      playlist.length > 1
        ? entryName(playlist[replay.index ?? 0])
        : sameEpisode
          ? old?.episode
          : undefined,
    progress: startAt > 0 ? startAt : sameEpisode ? (old?.progress ?? 0) : 0,
    duration: sameEpisode ? (old?.duration ?? 0) : 0,
    // 「下一集」还没真正开看（applyProgress 过了 MIN_PROGRESS 才清掉）
    nextUp: sameEpisode && startAt <= 0 ? old?.nextUp : undefined,
    updatedAt: now,
  })
}

/** 播放中的一次进度。 */
export interface ProgressUpdate {
  /** 当前集在播放列表里的下标 */
  index: number
  episode?: string
  progress: number
  duration: number
  /** 播到结尾（ended） */
  ended?: boolean
}

/**
 * 记进度：
 * - 看完且还有下一集 → 记成「下一集」，从头开始；
 * - 看完且是最后一集（或单片）→ 删掉记录；
 * - 不到 MIN_PROGRESS 秒且没有旧进度 → 不改（误点）。
 */
export function applyProgress(
  records: ContinueRecord[],
  id: string,
  update: ProgressUpdate,
  now: number
): ContinueRecord[] {
  const old = records.find(r => r.id === id)
  if (!old) return records
  const finished = update.ended || isFinished(update.progress, update.duration)
  const count = old.replay.playlist?.length ?? 1
  if (finished) {
    if (update.index + 1 >= count) return records.filter(r => r.id !== id)
    return put(records, {
      ...old,
      replay: withIndex(old.replay, update.index + 1),
      episode: entryName(old.replay.playlist?.[update.index + 1]),
      progress: 0,
      duration: 0,
      nextUp: true,
      updatedAt: now,
    })
  }
  if (update.progress < MIN_PROGRESS && old.progress < MIN_PROGRESS)
    return records
  return put(records, {
    ...old,
    replay: withIndex(old.replay, update.index),
    episode: update.episode || old.episode,
    progress: update.progress,
    duration: update.duration || old.duration,
    nextUp: false,
    updatedAt: now,
  })
}

/** 换到第 index 集：播放列表里有地址的，丢掉调用方预解析的起始地址（它只对应原来那一集，且可能过期）。 */
function withIndex(replay: ContinueReplay, index: number): ContinueReplay {
  if (!replay.playlist?.length) return replay
  const next = { ...replay, index }
  if (replay.playlist.some(entry => entry.url)) delete next.url
  return next
}

const entryName = (entry: PlaylistEntry | undefined): string | undefined =>
  typeof entry?.name === 'string' && entry.name.trim()
    ? entry.name.trim()
    : undefined

/** 记录里属于 ContinueMeta 的部分（重新开播时交回 openMediaPlayer）。 */
export function metaOf(record: ContinueRecord): ContinueMeta {
  const { section, key, title, cover, detail, partial } = record
  return {
    section,
    key,
    title,
    ...(cover ? { cover } : {}),
    detail,
    ...(partial ? { partial } : {}),
  }
}

/** 再次打开时交给 openMediaPlayer 的参数。 */
export function replayOptions(record: ContinueRecord): ContinueReplay & {
  title: string
  poster?: string
  startAt: number
} {
  return {
    ...withIndex(record.replay, record.replay.index ?? 0),
    title: [record.title, record.episode].filter(Boolean).join(' · '),
    ...(record.cover ? { poster: record.cover } : {}),
    startAt: record.nextUp ? 0 : record.progress,
  }
}

/** 某板块顶部要显示的记录（最近的在前）。 */
export function recordsFor(
  records: readonly ContinueRecord[],
  section: ContinueSection
): ContinueRecord[] {
  return records.filter(r => r.section === section).slice(0, CONTINUE_ROW_LIMIT)
}

/** 进度条比例 0–1。 */
export function progressRatio(record: ContinueRecord): number {
  if (record.nextUp || !(record.duration > 0)) return 0
  return Math.min(1, Math.max(0, record.progress / record.duration))
}

/** 封面右下角的剩余时间：「剩 18 分钟」「剩 1 小时 12 分」；下一集 / 时长未知时为空。 */
export function remainingLabel(record: ContinueRecord): string {
  if (record.nextUp || !(record.duration > 0)) return ''
  const minutes = Math.max(
    1,
    Math.round(Math.max(0, record.duration - record.progress) / 60)
  )
  if (minutes < 60) return `剩 ${minutes} 分钟`
  const m = minutes % 60
  return `剩 ${Math.floor(minutes / 60)} 小时${m ? ` ${m} 分` : ''}`
}

/** 上次观看：「刚刚」「25 分钟前」「3 小时前」「昨天」「4 天前」「10月3日」。 */
export function lastWatchedLabel(updatedAt: number, now: number): string {
  const minutes = Math.floor((now - updatedAt) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const day = (t: number): number => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((day(now) - day(updatedAt)) / 86400000)
  if (days === 0) return `${Math.floor(minutes / 60)} 小时前`
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const d = new Date(updatedAt)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 卡片副标题：「S01E05 · 上次 昨天」；下一集写「上一集已看完」。 */
export function subtitleOf(record: ContinueRecord, now: number): string {
  const when = `上次 ${lastWatchedLabel(record.updatedAt, now)}`
  if (record.nextUp) return `上一集已看完 · ${when}`
  return [record.episode, when].filter(Boolean).join(' · ')
}

/** 秒 → 「1:02:03」/「12:30」 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** 移除记录的墓碑：id → 移除时间。从片库补回记录时，不早于墓碑的不补。 */
export type ContinueTombstones = Record<string, number>

/** 墓碑最多留多少条（超出丢最早的）。 */
export const TOMBSTONE_LIMIT = 200

/** 记一块墓碑（同 id 覆盖），超出上限丢最早的。 */
export function addTombstone(
  stones: ContinueTombstones,
  id: string,
  at: number
): ContinueTombstones {
  const entries = Object.entries({ ...stones, [id]: at })
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOMBSTONE_LIMIT)
  return Object.fromEntries(entries)
}

/**
 * 并入别处来的记录（片库按观看进度生成的「继续看」）：每个 id 后写胜出（updatedAt 更大的留下），
 * 不晚于墓碑的不并入；结果按时间倒序、截到上限。没有变化时返回原数组。
 */
export function mergeRecords(
  records: ContinueRecord[],
  incoming: readonly ContinueRecord[],
  stones: ContinueTombstones
): ContinueRecord[] {
  let next = records
  for (const record of incoming) {
    if ((stones[record.id] ?? -1) >= record.updatedAt) continue
    const old = next.find(r => r.id === record.id)
    if (old && old.updatedAt >= record.updatedAt) continue
    next = put(next, record)
  }
  return next
}

/** 读回存储时校验：形状不对的丢掉。 */
export function sanitizeRecords(raw: unknown): ContinueRecord[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is ContinueRecord =>
        !!r &&
        typeof r === 'object' &&
        typeof r.id === 'string' &&
        typeof r.section === 'string' &&
        typeof r.key === 'string' &&
        typeof r.title === 'string' &&
        typeof r.progress === 'number' &&
        !!r.replay &&
        typeof r.replay === 'object'
    )
    .slice(0, CONTINUE_LIMIT)
}
