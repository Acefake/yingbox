/**
 * 节目单的显示规则（纯函数）：当前节目、播出进度、今日节目单的时间范围与每档状态。
 * 节目时间是毫秒时间戳，按本机时区算「今天」。
 */
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

/** 一档节目在节目单里的状态 */
export type ProgrammeState = 'past' | 'live' | 'upcoming'

/** 今日节目单的一行 */
export interface ScheduleRow extends EpgProgramme {
  state: ProgrammeState
}

/** 本机时区的今天 [0 点, 次日 0 点) */
export function todayRange(now: number): { from: number; to: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.getTime(), to: end.getTime() }
}

/**
 * 正在播出的节目（列表需按开始时间排序）。
 * @returns 没有覆盖 now 的节目时返回 null
 */
export function currentProgramme(
  list: readonly EpgProgramme[] | undefined,
  now: number
): EpgProgramme | null {
  if (!list?.length) return null
  let lo = 0
  let hi = list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const p = list[mid]
    if (now < p.start) hi = mid - 1
    else if (now >= p.stop) lo = mid + 1
    else return p
  }
  return null
}

/** 下一档节目（开始时间晚于 now 的第一档） */
export function nextProgramme(
  list: readonly EpgProgramme[] | undefined,
  now: number
): EpgProgramme | null {
  return list?.find(p => p.start > now) ?? null
}

/** 播出进度 0–1（时长无效时为 0） */
export function programmeProgress(p: EpgProgramme, now: number): number {
  const total = p.stop - p.start
  if (!(total > 0)) return 0
  return Math.min(1, Math.max(0, (now - p.start) / total))
}

/** 今日节目单：只取与今天有交集的节目并标上状态 */
export function scheduleRows(
  list: readonly EpgProgramme[] | undefined,
  now: number
): ScheduleRow[] {
  if (!list?.length) return []
  const { from, to } = todayRange(now)
  return list
    .filter(p => p.stop > from && p.start < to)
    .map(p => ({
      ...p,
      state: now >= p.stop ? 'past' : now >= p.start ? 'live' : 'upcoming',
    }))
}

/** 时刻 HH:mm（本机时区） */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
