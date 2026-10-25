/**
 * 洗版的纯规则：文件名里的分辨率、哪些文件该洗、候选算不算更好、多久搜一次、每天给洗版留多少 115 次数。
 *
 * 片库不存分辨率，只能看文件名（2160p / 4K / 1080p / 720p …）；认不出分辨率的文件不洗，
 * 免得把没写分辨率的 1080p 也当成低清每周去搜。
 */
import { dayKey } from '../schedule-rules'

const DAY = 24 * 3_600_000
/** 洗版每个文件多久搜一次 */
export const UPGRADE_INTERVAL_MS = 7 * DAY
/** 每天最多花在洗版上的 115 查询次数（闸门总限额 200，给剧集追更留够） */
export const UPGRADE_SNAPS_PER_DAY = 60
/** 每天最多花在电影上线追踪上的 115 查询次数 */
export const MOVIE_SNAPS_PER_DAY = 40

const RESOLUTION_RES: [RegExp, number][] = [
  [/(?:^|[^a-z0-9])(?:2160[pi]|4k|uhd|3840x2160)(?:[^a-z0-9]|$)/i, 2160],
  [/(?:^|[^a-z0-9])(?:1080[pi]|fhd|1920x1080)(?:[^a-z0-9]|$)/i, 1080],
  [/(?:^|[^a-z0-9])(?:720p|1280x720)(?:[^a-z0-9]|$)/i, 720],
  [/(?:^|[^a-z0-9])(?:480p|576p|360p)(?:[^a-z0-9]|$)/i, 480],
]

/**
 * 文件名里写明的分辨率。
 * @param name 文件名（可带所在文件夹）
 * @returns 2160 / 1080 / 720 / 480；认不出为 null
 */
export function resolutionOf(name: string): number | null {
  for (const [re, value] of RESOLUTION_RES) if (re.test(name)) return value
  return null
}

/** 分辨率显示名 */
export function resolutionLabel(value: number | null): string {
  if (value === null) return '未知'
  return value >= 2160 ? '4K' : `${value}p`
}

/** 这个文件要不要洗：分辨率认得出且低于目标 */
export function needsUpgrade(current: number | null, target: number): boolean {
  return current !== null && current < target
}

/** 候选算不算更好：达到目标，并且比现在的高 */
export function isBetter(
  current: number | null,
  target: number,
  candidate: number | null
): boolean {
  return candidate !== null && candidate >= target && candidate > (current ?? 0)
}

/** 每天的子限额计数（持久化在各自的状态文件里） */
export interface Budget {
  day: string
  snaps: number
}

/** 空计数 */
export function emptyBudget(now: number): Budget {
  return { day: dayKey(now), snaps: 0 }
}

/** 今天还剩多少次（跨天自动清零） */
export function budgetLeft(budget: Budget, now: number, limit: number): number {
  const day = dayKey(now)
  if (budget.day !== day) {
    budget.day = day
    budget.snaps = 0
  }
  return Math.max(0, limit - budget.snaps)
}

/** 今天的子限额用完了（不算失败：明天接着搜） */
export class BudgetSpent extends Error {
  constructor(what: string) {
    super(`今天给${what}的 115 查询次数已用完，明天继续`)
    this.name = 'BudgetSpent'
  }
}
