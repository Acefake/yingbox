/**
 * 周视图的「已入库」收起：把每天的行分成留在格子里的和收到底部的（按剧整部收，规则见 settledShowKeys）。
 */
import { type ComputedRef, computed } from 'vue'

import { showKey } from './calendar-rules'
import { type ShowDayGroup, settledShowKeys } from './calendar-rows'

interface DayRows {
  rows: ShowDayGroup[]
}

export interface UseSettledRowsReturn<T extends DayRows> {
  /** 每天剩下的行 */
  weekRows: ComputedRef<T[]>
  /** 收起的行，按日期先后 */
  settledRows: ComputedRef<ShowDayGroup[]>
  /** 收起了几部剧 */
  settledCount: ComputedRef<number>
}

export function useSettledRows<T extends DayRows>(
  days: () => T[],
  markOf: (group: ShowDayGroup) => unknown
): UseSettledRowsReturn<T> {
  const keys = computed(() =>
    settledShowKeys(
      days().flatMap(day => day.rows),
      markOf
    )
  )
  const settled = (group: ShowDayGroup): boolean =>
    keys.value.has(showKey(group.entries[0]))
  return {
    weekRows: computed(() =>
      days().map(day => ({ ...day, rows: day.rows.filter(g => !settled(g)) }))
    ),
    settledRows: computed(() =>
      days().flatMap(day => day.rows.filter(settled))
    ),
    settledCount: computed(() => keys.value.size),
  }
}
