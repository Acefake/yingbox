/**
 * 播放器这一侧的进度打通：媒体库条目只上报片库（不写本地进度表 / 已看完集合）、无痕不报，
 * 继续播放并入片库生成的记录（后写胜出、移除过的不补回），以及 mpv 会话的判定规则。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ incognito: false }))
vi.mock('@/features/incognito', () => ({ isIncognito: () => flags.incognito }))

const sinkModule =
  await import('../src/renderer/src/features/player/progress/library-sink')
const { useProgressSaver } =
  await import('../src/renderer/src/features/player/composables/use-progress-saver')
const { mergeRecords, addTombstone } =
  await import('../src/renderer/src/features/player/continue/continue-rules')
const { atEnd, mpvStep } =
  await import('../src/renderer/src/features/player/mpv-session/mpv-session-rules')
const { readMediaProgress } =
  await import('../src/renderer/src/features/player/utils/play-progress')

/** 内存版 localStorage */
function stubStorage(): void {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  })
}

const report = vi.fn()
const flush = vi.fn()

beforeEach(() => {
  stubStorage()
  report.mockClear()
  flush.mockClear()
  flags.incognito = false
  sinkModule.setLibraryProgressSink({
    resumeAt: ref => (ref.itemId === 1 ? 42 : undefined),
    report,
    flush,
  })
})

const video = (t: number, d: number): Event =>
  ({ target: { currentTime: t, duration: d } }) as unknown as Event

describe('媒体库条目的进度只记进片库', () => {
  it('节流上报、看完上报 ended；本地进度表与已看完集合都不写', () => {
    let now = 0
    const ref = { itemId: 1, fileId: 9 }
    const saver = useProgressSaver(
      () => '/tv/e1.mkv',
      () => now,
      () => {},
      () => ref
    )
    now = 5000
    saver.onTimeUpdate(video(120, 1000))
    now = 6000
    saver.onTimeUpdate(video(121, 1000))
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenLastCalledWith(ref, 120, 1000, false)
    saver.markFinished({ duration: 1000 } as HTMLVideoElement)
    expect(report).toHaveBeenLastCalledWith(ref, 1000, 1000, true)
    expect(flush).toHaveBeenCalled()
    expect(readMediaProgress('/tv/e1.mkv')).toBeNull()
  })

  it('不是媒体库条目照旧写本地；无痕时媒体库条目也不报', () => {
    const saver = useProgressSaver(
      () => 'https://cdn/a.m3u8',
      () => 99_999,
      () => {}
    )
    saver.onTimeUpdate(video(30, 100))
    expect(readMediaProgress('https://cdn/a.m3u8')).toMatchObject({
      progress: 30,
    })
    flags.incognito = true
    expect(
      sinkModule.reportLibraryProgress({ itemId: 1, fileId: 2 }, 1, 2)
    ).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })

  it('续播位置：媒体库条目问片库，坏标记不认', () => {
    expect(sinkModule.libraryResumeAt({ itemId: 1, fileId: 2 })).toBe(42)
    expect(sinkModule.libraryResumeAt({ itemId: 'x' })).toBeUndefined()
    expect(sinkModule.isLibraryRef({ itemId: 1, fileId: 0 })).toBe(false)
  })
})

describe('继续播放并入片库生成的记录', () => {
  const rec = (
    id: string,
    updatedAt: number
  ): Parameters<typeof mergeRecords>[0][number] => ({
    id,
    section: 'tv' as const,
    key: id.split(':')[1],
    title: id,
    replay: {},
    progress: 10,
    duration: 100,
    updatedAt,
  })
  it('后写胜出，墓碑之后才补回，按时间倒序', () => {
    const local = [rec('tv:1', 10), rec('tv:2', 5)]
    const stones = addTombstone({}, 'tv:3', 20)
    const merged = mergeRecords(
      local,
      [rec('tv:1', 8), rec('tv:2', 30), rec('tv:3', 15), rec('tv:4', 1)],
      stones
    )
    expect(merged.map(r => [r.id, r.updatedAt])).toEqual([
      ['tv:2', 30],
      ['tv:1', 10],
      ['tv:4', 1],
    ])
    expect(
      mergeRecords(local, [rec('tv:3', 25)], stones).map(r => r.id)
    ).toContain('tv:3')
    expect(mergeRecords(local, [rec('tv:1', 1)], {})).toBe(local)
  })
})

describe('mpv 会话判定', () => {
  const base = { running: true, loading: false, paused: false }
  const tick = { finished: false, counting: false, lastSave: 0 }
  it('暂停在结尾才算播完', () => {
    expect(atEnd({ position: 999, duration: 1000, paused: true })).toBe(true)
    expect(atEnd({ position: 999, duration: 1000, paused: false })).toBe(false)
    expect(atEnd({ position: 990, duration: 1000, paused: true })).toBe(false)
  })
  it('退出 / 加载中 / 记进度 / 播完 / 倒计时中拖回去取消', () => {
    expect(mpvStep({ ...base, running: false }, tick, 0).kind).toBe('stop')
    expect(mpvStep({ ...base, loading: true }, tick, 0).kind).toBe('idle')
    expect(
      mpvStep({ ...base, position: 10, duration: 100 }, tick, 2000).kind
    ).toBe('save')
    expect(
      mpvStep({ ...base, position: 10, duration: 100 }, tick, 1000).kind
    ).toBe('idle')
    const end = { ...base, paused: true, position: 100, duration: 100 }
    expect(mpvStep(end, tick, 0).kind).toBe('finish')
    expect(mpvStep(end, { ...tick, finished: true }, 0).kind).toBe('idle')
    expect(
      mpvStep(
        { ...base, position: 50, duration: 100 },
        { ...tick, counting: true },
        0
      ).kind
    ).toBe('cancel')
  })
})
