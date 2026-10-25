/**
 * 自动字幕的状态（片库设置表，键 subtitles.auto.state）：今天下了几份、每个视频的进度。
 *
 * 每个视频一条，键是条目 id，也就是幂等键：同一集 / 电影只会处理到 done 或 skipped 为止。
 * - pending：等着做（nextTry 之前不做）；
 * - done：已经有中文字幕（本来就有，或这次下好了）；
 * - skipped：做不了（远程源、目录不可写、试满次数还没找到），reason 写明原因。
 * 读的时候逐字段校验，坏数据当作空状态；只留最近 {@link MAX_ENTRIES} 条。
 */

/** 一个视频的进度。 */
export interface SubtitleEntry {
  itemId: number
  libraryId: number
  /** 视频文件路径 */
  path: string
  status: 'pending' | 'done' | 'skipped'
  attempts: number
  /** 早于它不做；null 表示马上可以做 */
  nextTry: number | null
  /** 结果说明（下载的文件名 / 跳过原因 / 上一次失败原因） */
  reason: string | null
  updatedAt: number
}

/** 整份状态。 */
export interface SubtitleState {
  day: string
  downloads: number
  entries: Record<string, SubtitleEntry>
}

/** 最多保留几条。 */
export const MAX_ENTRIES = 2000

const STATUSES = ['pending', 'done', 'skipped'] as const

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function parseEntry(raw: unknown): SubtitleEntry | null {
  if (!isObj(raw)) return null
  const itemId = num(raw.itemId)
  const libraryId = num(raw.libraryId)
  const status = STATUSES.find(s => s === raw.status)
  if (itemId === null || libraryId === null || !status) return null
  if (typeof raw.path !== 'string' || !raw.path) return null
  return {
    itemId,
    libraryId,
    path: raw.path,
    status,
    attempts: num(raw.attempts) ?? 0,
    nextTry: num(raw.nextTry),
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    updatedAt: num(raw.updatedAt) ?? 0,
  }
}

/** 解析持久化的状态；坏数据当作空状态。 */
export function parseSubtitleState(
  raw: string | undefined,
  day: string
): SubtitleState {
  const empty: SubtitleState = { day, downloads: 0, entries: {} }
  let value: unknown
  try {
    value = JSON.parse(raw ?? '')
  } catch {
    return empty
  }
  if (!isObj(value) || !isObj(value.entries)) return empty
  const entries: Record<string, SubtitleEntry> = {}
  for (const item of Object.values(value.entries)) {
    const entry = parseEntry(item)
    if (entry) entries[String(entry.itemId)] = entry
  }
  const sameDay = value.day === day
  return {
    day,
    downloads: sameDay ? (num(value.downloads) ?? 0) : 0,
    entries,
  }
}

/** 只留最近更新的 {@link MAX_ENTRIES} 条（等着做的不删）。 */
export function pruneEntries(state: SubtitleState): void {
  const list = Object.values(state.entries)
  if (list.length <= MAX_ENTRIES) return
  const finished = list
    .filter(e => e.status !== 'pending')
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const entry of finished.slice(0, list.length - MAX_ENTRIES))
    delete state.entries[String(entry.itemId)]
}

/** 下一个该做的时间；没有等着做的返回 null。 */
export function nextDue(state: SubtitleState): number | null {
  let next: number | null = null
  for (const e of Object.values(state.entries)) {
    if (e.status !== 'pending') continue
    const at = e.nextTry ?? 0
    if (next === null || at < next) next = at
  }
  return next
}
