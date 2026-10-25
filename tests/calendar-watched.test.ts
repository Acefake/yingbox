// test-affected: repo-wide
/**
 * 追剧日历的两处修正：
 * - 已看判定认播放器的独立「已看完」标记：看完后续播点清零、继续播放记录被删，这集仍算看过；
 * - 页面按完整区间缓存键（今天|周一|周日）重新加载：同一周内跨零点也会重新请求当前周。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, watch } from 'vue'

import { libraryEpisodeWatched } from '../src/renderer/src/features/calendar/calendar-rules'
import { useProgressSaver } from '../src/renderer/src/features/player/composables/use-progress-saver'
import { readMediaProgress } from '../src/renderer/src/features/player/utils/play-progress'

const fetchCalendarEpisodes = vi.fn()

vi.mock('@/features/library', () => ({
  fetchCalendarEpisodes: (range: unknown) => fetchCalendarEpisodes(range),
  libraryProgressKey: (_id: unknown, path?: string) => path ?? '',
}))
vi.mock('@/features/player', () => ({
  continueRecords: () => ref([]),
  readMediaProgress: () => null,
}))

const stubStorage = (): void => {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('已看判定认「已看完」标记', () => {
  it('看完最后一集：续播点清零、继续播放记录已删，这集仍算看过', () => {
    stubStorage()
    const key = '/tv/show/S01E08.mkv'
    const saver = useProgressSaver(() => key)
    saver.markFinished({ duration: 2400 } as HTMLVideoElement)
    const progress = readMediaProgress(key)
    expect(progress).toMatchObject({
      progress: 0,
      duration: 2400,
      finished: true,
    })
    expect(
      libraryEpisodeWatched({ season: 1, episode: 8 }, undefined, progress)
    ).toBe(true)
  })

  it('没有标记时仍按原判据：零秒进度不算看过，过 90% 算看过', () => {
    stubStorage()
    const ep = { season: 1, episode: 2 }
    expect(
      libraryEpisodeWatched(ep, undefined, {
        progress: 0,
        duration: 2400,
        finished: false,
      })
    ).toBe(false)
    expect(
      libraryEpisodeWatched(ep, undefined, { progress: 2300, duration: 2400 })
    ).toBe(true)
  })
})

describe('跨零点重新加载当前区间', () => {
  it('同一周内过了零点：周一不变但缓存键变了，按新键重新请求', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 21, 23, 59))
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('window', {
      setInterval: () => 0,
      addEventListener: (name: string, fn: () => void) =>
        (listeners[name] = fn),
    })
    fetchCalendarEpisodes.mockResolvedValue({
      configured: true,
      failed: 0,
      episodes: [],
    })
    const { useCalendar } =
      await import('../src/renderer/src/features/calendar/use-calendar')
    const cal = useCalendar()
    // 与 CalendarView.vue 相同的监听
    const stop = watch(cal.rangeKey, () => void cal.load(), {
      immediate: true,
    })
    await vi.waitFor(() => expect(cal.loading.value).toBe(false))
    expect(fetchCalendarEpisodes).toHaveBeenCalledTimes(1)
    const monday = cal.start.value
    const before = cal.rangeKey.value

    vi.setSystemTime(new Date(2026, 9, 22, 0, 1))
    listeners.focus()
    await nextTick()
    expect(cal.start.value).toBe(monday)
    expect(cal.rangeKey.value).not.toBe(before)
    expect(fetchCalendarEpisodes).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(cal.result.value).not.toBeNull())
    stop()
  })

  it('日历页监听完整区间缓存键，而不只是周一', () => {
    const view = readFileSync(
      join(
        __dirname,
        '..',
        'src/renderer/src/features/calendar/views/CalendarView.vue'
      ),
      'utf8'
    )
    expect(view).toContain('watch(cal.rangeKey, () => void cal.load()')
    expect(view).not.toContain('watch(cal.start,')
  })
})
