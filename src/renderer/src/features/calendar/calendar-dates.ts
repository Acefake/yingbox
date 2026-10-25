/**
 * 追剧日历的日期规则：本地日期键、周一开头的周、翻周、按周分组。
 *
 * 日期键一律是本地时区的 YYYY-MM-DD（字典序即日期序）；只用 Date 的本地年月日，不受夏令时影响。
 * 纯函数，不依赖 Vue，测试直接调用。
 */

/** 一周七天的中文名（周一开头）。 */
export const WEEKDAY_NAMES = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
] as const

const pad = (n: number): string => String(n).padStart(2, '0')

/** Date → 本地日期键 YYYY-MM-DD。 */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 日期键 → 本地零点的 Date；格式不对返回 null。 */
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return dateKey(date) === key ? date : null
}

/** 日期键加减天数。 */
export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  if (!date) return key
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

/** 两个日期键相差几天（b - a）。 */
export function daysBetween(a: string, b: string): number {
  const da = parseDateKey(a)
  const db = parseDateKey(b)
  if (!da || !db) return 0
  // 用 UTC 零点相减，避开夏令时那天只有 23 / 25 小时
  const utc = (d: Date): number =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((utc(db) - utc(da)) / 86_400_000)
}

/** 某天所在周的周一。 */
export function weekStart(key: string): string {
  const date = parseDateKey(key)
  if (!date) return key
  const offset = (date.getDay() + 6) % 7 // 周一 = 0 … 周日 = 6
  return addDays(key, -offset)
}

/** 一周七天的日期键（start 是周一）。 */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** 往前 / 往后翻 n 周，返回那周的周一。 */
export function shiftWeek(start: string, weeks: number): string {
  return addDays(weekStart(start), weeks * 7)
}

/** 周的标题：「10月20日 – 10月26日」，跨年时带年份。 */
export function weekLabel(start: string, today: string): string {
  const end = addDays(start, 6)
  const ds = parseDateKey(start)
  const de = parseDateKey(end)
  if (!ds || !de) return ''
  const thisYear = parseDateKey(today)?.getFullYear()
  const fmt = (d: Date, withYear: boolean): string =>
    `${withYear ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日`
  const withYear =
    ds.getFullYear() !== de.getFullYear() || ds.getFullYear() !== thisYear
  return `${fmt(ds, withYear)} – ${fmt(de, withYear)}`
}

/**
 * 页头统计用的周称呼：本周 / 下周 / 上周，更远的周写「10月27日那周」（不在今年时带年份）。
 * @param start 那周的任意一天（按所在周的周一算）
 * @param today 今天的日期键
 */
export function weekPrefix(start: string, today: string): string {
  const diff = daysBetween(weekStart(today), weekStart(start)) / 7
  if (diff === 0) return '本周'
  if (diff === 1) return '下周'
  if (diff === -1) return '上周'
  const date = parseDateKey(weekStart(start))
  if (!date) return '这一周'
  const year =
    date.getFullYear() === parseDateKey(today)?.getFullYear()
      ? ''
      : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日那周`
}

/** 一天的展示名：「今天 · 周六 24」或「周一 20」。 */
export function dayLabel(key: string, today: string): string {
  const date = parseDateKey(key)
  if (!date) return key
  const name = WEEKDAY_NAMES[(date.getDay() + 6) % 7]
  const prefix = key === today ? '今天 · ' : ''
  return `${prefix}${name} ${date.getDate()}`
}

/**
 * 周视图列头的两部分：星期名与几号（「周一」「19」）；日期不合法时星期名为原字符串、几号为空。
 * @param key YYYY-MM-DD
 */
export function dayParts(key: string): { weekday: string; day: string } {
  const date = parseDateKey(key)
  if (!date) return { weekday: key, day: '' }
  return {
    weekday: WEEKDAY_NAMES[(date.getDay() + 6) % 7],
    day: String(date.getDate()),
  }
}

/** 一周里的一天和当天的条目。 */
export interface DayBucket<T> {
  date: string
  isToday: boolean
  items: T[]
}

/**
 * 按周分组：返回周一到周日七个格子，每格放播出日期是那天的条目（保持传入顺序）；
 * 不在这周或没有日期的条目不出现。
 */
export function groupByWeek<T extends { airDate: string | null }>(
  items: readonly T[],
  start: string,
  today: string
): DayBucket<T>[] {
  const days = weekDays(weekStart(start))
  const buckets = days.map(date => ({
    date,
    isToday: date === today,
    items: [] as T[],
  }))
  const index = new Map(days.map((d, i) => [d, i]))
  for (const item of items) {
    const i = item.airDate === null ? undefined : index.get(item.airDate)
    if (i !== undefined) buckets[i].items.push(item)
  }
  return buckets
}
