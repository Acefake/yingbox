/**
 * 追更的纯规则 · 什么时候搜：哪些集该搜了、下一次什么时候再搜、什么时候放弃。
 *
 * TMDB 的播出日是播出地日期：从播出日当天 20:00（本地时间）开始搜，前 48 小时每 4 小时一次，
 * 之后每天一次，播出后 {@link GIVE_UP_DAYS} 天还没找到就记为找不到、不再搜。
 * 日期都是 YYYY-MM-DD，时间都是毫秒时间戳；「本地」由调用方传入的 Date 决定。
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** 播出后多少天放弃 */
export const GIVE_UP_DAYS = 14
/** 往回看多少天的播出 */
export const LOOKBACK_DAYS = 14
/** 播出当天几点开始搜 */
export const START_HOUR = 20
/** 前 48 小时的搜索间隔 */
const EARLY_GAP = 4 * HOUR
const EARLY_SPAN = 48 * HOUR

/** 剧 id:季:集 */
export function episodeKey(
  seriesId: number,
  season: number,
  episode: number
): string {
  return `${seriesId}:${season}:${episode}`
}

/** 本地日期键 YYYY-MM-DD */
export function localDate(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 日期 + 天数 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days, 12).getTime())
}

/** 某一集第一次可以搜的时间：播出日当天 {@link START_HOUR} 点（本地） */
export function searchStart(airDate: string): number {
  const [y, m, d] = airDate.split('-').map(Number)
  return new Date(y, m - 1, d, START_HOUR).getTime()
}

/**
 * 搜过一次（没找到）之后的下一次时间；该放弃时返回 null。
 * 间隔从上次搜的时间算，不从播出时间算，所以应用关了几天再打开也只补一次。
 */
export function nextTry(airDate: string, now: number): number | null {
  const start = searchStart(airDate)
  const giveUp = start + GIVE_UP_DAYS * DAY
  const next = now + (now - start < EARLY_SPAN ? EARLY_GAP : DAY)
  return next > giveUp ? null : next
}

/** 这一集现在能不能搜：已播出到可搜时间，并且到了记录的下次时间 */
export function isDue(
  airDate: string,
  next: number | null,
  now: number
): boolean {
  if (next === null) return false
  return now >= searchStart(airDate) && now >= next
}

/** 往后看多少天的播出（只为列出在播和即将开播的剧，建缺集仍只看已播出的） */
export const LOOKAHEAD_DAYS = 30

/** 日历查询区间：往回 {@link LOOKBACK_DAYS} 天到往后 {@link LOOKAHEAD_DAYS} 天 */
export function calendarRange(now: number): { from: string; to: string } {
  const today = localDate(now)
  return {
    from: addDays(today, -LOOKBACK_DAYS),
    to: addDays(today, LOOKAHEAD_DAYS),
  }
}

/** 本地日期键（按天清零计数用） */
export const dayKey = localDate
