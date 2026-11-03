/**
 * 「已看完」集合的纯规则：一条记录 = 进度键 + 看完的时间，最新的在前、按键去重、有上限。
 *
 * 进度键与播放进度表一致（mediaProgressKey：地址优先，其次文件路径）。
 * 看完是独立的标记，不能从进度表推断：进度表里位置 0 既可能是看完清零，也可能是拖回开头。
 * 不依赖存储，读写在 watched-store.ts。
 */

/** 最多记住多少条看完记录（超出丢最早的）。 */
export const WATCHED_LIMIT = 1000

/** 一条看完记录。 */
export interface WatchedEntry {
  /** 进度键 */
  key: string
  /** 看完的时间（毫秒时间戳） */
  at: number
}

/** 存储里读出的一项是否是合法记录（老数据或手改的坏数据直接丢弃）。 */
export function isWatchedEntry(value: unknown): value is WatchedEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<WatchedEntry>
  return (
    typeof entry.key === 'string' &&
    entry.key.trim() !== '' &&
    typeof entry.at === 'number' &&
    Number.isFinite(entry.at)
  )
}

/**
 * 记一条看完：同键的旧记录移到最前，超出上限丢最早的。
 * @param list 现有记录（最新的在前）
 * @param key 进度键（空串不记）
 * @param at 看完的时间
 * @param limit 上限
 * @returns 新列表（不改原列表）
 */
export function addWatched(
  list: readonly WatchedEntry[],
  key: string,
  at: number,
  limit = WATCHED_LIMIT
): WatchedEntry[] {
  const k = key.trim()
  if (!k) return [...list]
  return [{ key: k, at }, ...list.filter(e => e.key !== k)].slice(0, limit)
}

/** 去掉一条看完记录（例如用户手动标成未看）。 */
export function removeWatched(
  list: readonly WatchedEntry[],
  key: string
): WatchedEntry[] {
  const k = key.trim()
  return list.filter(e => e.key !== k)
}

/** 这个进度键是否看完过。 */
export function hasWatched(
  list: readonly WatchedEntry[],
  key: string
): boolean {
  const k = key.trim()
  return !!k && list.some(e => e.key === k)
}
