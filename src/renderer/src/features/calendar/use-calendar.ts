/**
 * 追剧日历的数据：全应用一份（模块单例），日历页和侧栏角标共用。
 *
 * - 媒体库部分：按日期区间向片库要播出数据（calendar.episodes）。引擎侧每部剧每天最多刷新一次 TMDB；
 *   这里再按「今天 + 区间」记住结果，同一天来回切页不重复调用。
 * - 在线部分：直接读「继续播放」记录（响应式），不联网。
 * - 已看 / 未看：「已看完」标记 + 「继续播放」记录 + 文件播放进度（规则见 calendar-rules.ts）。
 * - 「今天」每分钟和窗口获得焦点时校正一次，过了零点角标与高亮自动跟上。
 */
import { type Ref, computed, ref, shallowRef, watch } from 'vue'

import type {
  CalendarEpisode,
  CalendarResult,
} from '../../../../shared/library/ipc'
import { fetchCalendarEpisodes, libraryProgressKey } from '@/features/library'
import { continueRecords, readMediaProgress } from '@/features/player'

import { addDays, dateKey, weekStart } from './calendar-dates'
import {
  type CalendarEntry,
  type ProgressLike,
  badgeCount,
  badgeRange,
  compareEntries,
  libraryEntries,
  onlineEntries,
} from './calendar-rules'

/** 一段日期的媒体库数据的加载状态。 */
interface RangeState {
  result: CalendarResult | null
  loading: boolean
  error: string | null
}

const today = ref(dateKey(new Date()))
/** 键：今天|from|to */
const ranges = shallowRef(new Map<string, RangeState>())
const inflight = new Map<string, Promise<void>>()
let clockStarted = false

function startClock(): void {
  if (clockStarted || typeof window === 'undefined') return
  clockStarted = true
  const tick = (): void => {
    const now = dateKey(new Date())
    if (now !== today.value) today.value = now
  }
  window.setInterval(tick, 60_000)
  window.addEventListener('focus', tick)
}

const rangeKey = (from: string, to: string): string =>
  `${today.value}|${from}|${to}`

function setRange(key: string, state: RangeState): void {
  const next = new Map(ranges.value)
  next.set(key, state)
  ranges.value = next
}

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^\[library:[a-z-]+\]\s*/,
    ''
  )

/** 加载一段日期（同一天内已加载过就不再请求，force 时重新请求）。 */
function loadRange(from: string, to: string, force = false): Promise<void> {
  const key = rangeKey(from, to)
  const running = inflight.get(key)
  if (running) return running
  const old = ranges.value.get(key)
  if (old && !force && (old.result || old.error)) return Promise.resolve()
  const request = fetchCalendarEpisodes({ from, to })
  if (!request) {
    setRange(key, { result: null, loading: false, error: null })
    return Promise.resolve()
  }
  setRange(key, { result: old?.result ?? null, loading: true, error: null })
  const job = request
    .then(result => setRange(key, { result, loading: false, error: null }))
    .catch(error =>
      setRange(key, {
        result: old?.result ?? null,
        loading: false,
        error: errorText(error),
      })
    )
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/** 一集的文件播放进度与「已看完」标记。 */
function progressOf(ep: CalendarEpisode): ProgressLike | null {
  const key = libraryProgressKey(ep.fileId, ep.filePath)
  return key ? readMediaProgress(key) : null
}

/** 某段日期的全部卡片（媒体库 + 在线），已排序。 */
function entriesFor(state: RangeState | undefined): CalendarEntry[] {
  const records = continueRecords().value
  const library = libraryEntries(
    state?.result?.episodes ?? [],
    today.value,
    records,
    progressOf
  )
  return [...library, ...onlineEntries(records, today.value)].sort(
    compareEntries
  )
}

let badgeStarted = false

/** 查角标要用的那一段（最近 7 天）。 */
function loadBadgeRange(): void {
  const { from, to } = badgeRange(today.value)
  void loadRange(from, to)
}

/**
 * 侧栏角标：最近 7 天播出、还没看的新集数。
 * 第一次调用时延后几秒再查媒体库，不和启动时的其它请求抢；过了零点按新的一段补查。
 */
export function useCalendarBadge(): Readonly<Ref<number>> {
  startClock()
  if (!badgeStarted && typeof window !== 'undefined') {
    badgeStarted = true
    setTimeout(loadBadgeRange, 3000)
    watch(today, loadBadgeRange)
  }
  return computed(() => {
    const { from, to } = badgeRange(today.value)
    const state = ranges.value.get(rangeKey(from, to))
    return badgeCount(entriesFor(state), today.value)
  })
}

/** 日历页的视图模式。 */
export type CalendarMode = 'week' | 'list'

const mode = ref<CalendarMode>('week')
const shownWeek = ref<string | null>(null)

/** 日历页用到的状态与操作。 */
export interface CalendarState {
  today: Readonly<Ref<string>>
  mode: Ref<CalendarMode>
  /** 当前周的周一 / 周日 */
  start: Readonly<Ref<string>>
  end: Readonly<Ref<string>>
  /** 当前显示区间的缓存键（今天|周一|周日）；跨零点或换周都会变，页面据此重新加载 */
  rangeKey: Readonly<Ref<string>>
  /** 这一周的媒体库卡片 + 全部在线剧卡片，已排序 */
  entries: Readonly<Ref<CalendarEntry[]>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<string | null>>
  result: Readonly<Ref<CalendarResult | null>>
  isThisWeek: Readonly<Ref<boolean>>
  load(force?: boolean): Promise<void>
  shift(weeks: number): void
  goToday(): void
}

/** 日历页：当前周、视图模式、这一周的卡片与加载状态。 */
export function useCalendar(): CalendarState {
  startClock()
  const start = computed(() => shownWeek.value ?? weekStart(today.value))
  const end = computed(() => addDays(start.value, 6))
  const key = computed(() => rangeKey(start.value, end.value))
  const state = computed(() => ranges.value.get(key.value))

  /** 加载当前周（翻周、回到本周时调用）。 */
  const load = (force = false): Promise<void> =>
    loadRange(start.value, end.value, force)

  return {
    today,
    mode,
    start,
    end,
    rangeKey: key,
    entries: computed(() => entriesFor(state.value)),
    loading: computed(() => state.value?.loading ?? false),
    error: computed(() => state.value?.error ?? null),
    result: computed(() => state.value?.result ?? null),
    isThisWeek: computed(() => start.value === weekStart(today.value)),
    load,
    /** 往前 / 往后翻 n 周。 */
    shift(weeks: number): void {
      shownWeek.value = addDays(start.value, weeks * 7)
      void load()
    },
    /** 回到本周。 */
    goToday(): void {
      shownWeek.value = null
      void load()
    },
  }
}
