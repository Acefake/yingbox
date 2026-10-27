/**
 * 洗版的纯规则：多久搜一次、每天给洗版 / 电影追踪留多少 115 次数。
 *
 * 文件名里的画质、哪些文件该洗、候选算不算更好在 shared/release（quality.ts、score.ts 的
 * wantsUpgrade / isBetterVersion）：片库不存分辨率，只能看文件名；认不出分辨率的文件不洗。
 */
import { dayKey } from '../schedule-rules'

const DAY = 24 * 3_600_000
/** 洗版每个文件多久搜一次 */
export const UPGRADE_INTERVAL_MS = 7 * DAY
/** 每天最多花在洗版上的 115 查询次数（闸门总限额 200，给剧集追更留够） */
export const UPGRADE_SNAPS_PER_DAY = 60
/** 每天最多花在电影上线追踪上的 115 查询次数 */
export const MOVIE_SNAPS_PER_DAY = 40

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
