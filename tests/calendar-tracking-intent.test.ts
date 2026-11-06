// @vitest-environment jsdom
import { computed, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import {
  useCalendar,
  useCalendarBadge,
} from '../src/renderer/src/features/calendar/use-calendar'

vi.mock('@/features/library', () => ({
  fetchCalendarEpisodes: () => null,
  libraryItemProgress: () => null,
  libraryProgressKey: () => null,
  loadLibraryProgress: async () => {},
}))
vi.mock('@/features/player', () => ({
  continueRecords: () => records,
  readMediaProgress: () => null,
}))
vi.mock('@/features/autograb', () => ({
  useOnlineTracking: () => ({
    schedule: { value: [] },
    isTracked: (show: { recordId: string }) =>
      followed.value.has(show.recordId),
  }),
}))

const followed = ref(new Set<string>())
const records = computed(() => [
  {
    id: 'played',
    title: '只播放过的剧',
    section: 'online',
    nextUp: false,
    detail: { vod_remarks: '更新至3集' },
    replay: { index: 0, playlist: [{}, {}, {}] },
  },
])

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('仅播放不进入日历和角标，明确追更才显示，取消后同步移除', () => {
  vi.useFakeTimers()
  const calendar = useCalendar()
  const badge = useCalendarBadge()
  expect(calendar.entries.value).toEqual([])
  expect(badge.value).toBe(0)
  followed.value = new Set(['played'])
  expect(calendar.entries.value.map(entry => entry.id)).toEqual(['played'])
  expect(badge.value).toBe(2)
  followed.value = new Set()
  expect(calendar.entries.value).toEqual([])
  expect(badge.value).toBe(0)
})
