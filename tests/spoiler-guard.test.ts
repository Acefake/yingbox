// test-affected: repo-wide
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { settingsSchema } from '../src/shared/settings/schema'
import { useProgressSaver } from '../src/renderer/src/features/player/composables/use-progress-saver'
import { readMediaProgress } from '../src/renderer/src/features/player/utils/play-progress'
import {
  WATCHED_STORAGE_KEY,
  isWatched,
  markWatched,
  unmarkWatched,
} from '../src/renderer/src/features/player/watched'
import {
  addWatched,
  hasWatched,
  isWatchedEntry,
  removeWatched,
} from '../src/renderer/src/features/player/watched/watched-rules'
import {
  type ProgressEntry,
  SEEN_MIN_PROGRESS,
  isEpisodeSeen,
  progressSeen,
  seenKeysFromContinue,
  spoilerHidden,
} from '../src/renderer/src/features/library/detail/spoiler-rules'

/**
 * 防剧透：哪些集算看过（进度表 / 继续播放记录）、开关关闭时不遮、设置项默认关，以及详情与设置页的接线。
 */

const playlist = ['/tv/e1.mkv', '/tv/e2.mkv', '/tv/e3.mkv', '/tv/e4.mkv'].map(
  filePath => ({ filePath })
)
type ContinueLike = Parameters<typeof seenKeysFromContinue>[0]
const record = (
  index: number,
  progress: number,
  nextUp?: boolean
): ContinueLike => ({
  replay: { playlist, index },
  progress,
  nextUp,
})
const none = (): ProgressEntry | null => null

describe('spoiler-rules', () => {
  it('进度表：播过一段或看完标记算看过，误点不算', () => {
    expect(progressSeen(null)).toBe(false)
    expect(progressSeen({ progress: 3, duration: 1500 })).toBe(false)
    expect(progressSeen({ progress: SEEN_MIN_PROGRESS, duration: 0 })).toBe(
      true
    )
    // 位置 0 不再当看完（可能只是拖回开头），只认独立的看完标记
    expect(progressSeen({ progress: 0, duration: 1500 })).toBe(false)
    expect(progressSeen({ progress: 0, duration: 0 })).toBe(false)
    expect(progressSeen({ progress: 0, duration: 1500, finished: true })).toBe(
      true
    )
    expect(progressSeen({ progress: 0, duration: 1500, finished: false })).toBe(
      false
    )
  })

  it('继续播放：当前集之前都算看过，当前集开始看了也算', () => {
    expect([...seenKeysFromContinue(record(2, 600))]).toEqual([
      '/tv/e1.mkv',
      '/tv/e2.mkv',
      '/tv/e3.mkv',
    ])
    // 刚开（不到 10 秒）只算之前的
    expect([...seenKeysFromContinue(record(2, 5))]).toEqual([
      '/tv/e1.mkv',
      '/tv/e2.mkv',
    ])
    // 「下一集」还没开始看
    expect([...seenKeysFromContinue(record(1, 0, true))]).toEqual([
      '/tv/e1.mkv',
    ])
    expect(seenKeysFromContinue(undefined).size).toBe(0)
    expect(
      seenKeysFromContinue({ replay: { filePath: '/m.mkv' }, progress: 900 })
        .size
    ).toBe(0)
  })

  it('网页端连播列表按地址取键；下标越界按最后一集算', () => {
    const urls = [{ url: 'https://lib/media/files/1' }, { url: ' ' }]
    const seen = seenKeysFromContinue({
      replay: { playlist: urls, index: 9 },
      progress: 60,
    })
    expect([...seen]).toEqual(['https://lib/media/files/1'])
  })

  it('一集任一文件看过就算看过；开关关闭不遮；没有文件的集开着时要遮', () => {
    const seen = seenKeysFromContinue(record(1, 0, true))
    const progress = (key: string): ProgressEntry | null =>
      key === '/tv/e3.mkv' ? { progress: 800, duration: 1500 } : null
    expect(isEpisodeSeen(['/tv/e1.mkv'], seen, progress)).toBe(true)
    expect(isEpisodeSeen(['/tv/e2.mkv'], seen, progress)).toBe(false)
    expect(isEpisodeSeen(['/x/cd1.mkv', '/tv/e3.mkv'], seen, progress)).toBe(
      true
    )
    expect(spoilerHidden(true, ['/tv/e2.mkv'], seen, progress)).toBe(true)
    expect(spoilerHidden(false, ['/tv/e2.mkv'], seen, progress)).toBe(false)
    expect(spoilerHidden(true, [], seen, none)).toBe(true)
    expect(spoilerHidden(true, ['/tv/e1.mkv'], seen, none)).toBe(false)
  })
})

describe('设置与接线', () => {
  const src = (path: string): string =>
    readFileSync(join(__dirname, '../src/renderer/src', path), 'utf8')

  it('设置项 ui.spoilerGuard 默认关', () => {
    expect(settingsSchema['ui.spoilerGuard'].default).toBe(false)
  })

  it('剧集列表按遮挡集合加 is-spoiler，剧照模糊、简介折叠、悬停 / 聚焦显示', () => {
    const seasons = src('features/library/detail/DetailSeasons.vue')
    expect(seasons).toContain("'is-spoiler': spoilerIds.has(ep.id)")
    expect(seasons).toContain('useSpoilerGuard(')
    expect(seasons).toMatch(
      /\.is-spoiler \.lib-episode-still img \{\s+filter: blur/
    )
    expect(seasons).toMatch(
      /\.is-spoiler \.lib-episode-overview \{\s+display: none/
    )
    expect(seasons).toContain(
      '.lib-episode.is-spoiler:hover .lib-episode-overview'
    )
    expect(seasons).toContain('.lib-episode.is-spoiler:focus-within')
    const guard = src('features/library/detail/use-spoiler-guard.ts')
    expect(guard).toContain("useSetting('ui.spoilerGuard')")
    expect(guard).toContain('continueRecords()')
    expect(guard).toContain('readMediaProgress')
  })

  it('设置 · 外观里有开关', () => {
    const page = src('features/settings/sections/AppearanceSettings.vue')
    expect(page).toContain("useSetting('ui.spoilerGuard')")
    expect(page).toContain('<UiSwitch v-model="spoilerGuard"')
  })
})

describe('已看完集合', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubStorage = (): Record<string, string> => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => (store[k] = v),
    })
    return store
  }

  it('规则：去重、最新在前、有上限，坏数据丢弃', () => {
    let list = addWatched([], 'a', 1)
    list = addWatched(list, 'b', 2)
    list = addWatched(list, 'a', 3)
    expect(list).toEqual([
      { key: 'a', at: 3 },
      { key: 'b', at: 2 },
    ])
    expect(addWatched(list, 'c', 4, 2).map(e => e.key)).toEqual(['c', 'a'])
    expect(addWatched(list, '  ', 5)).toEqual(list)
    expect(hasWatched(list, 'b')).toBe(true)
    expect(hasWatched(removeWatched(list, 'b'), 'b')).toBe(false)
    expect(isWatchedEntry({ key: 'a', at: 1 })).toBe(true)
    expect(isWatchedEntry({ key: '', at: 1 })).toBe(false)
    expect(isWatchedEntry({ key: 'a' })).toBe(false)
  })

  it('存储：标记 / 取消，老数据（只有进度表）照常读', () => {
    const store = stubStorage()
    store.media_play_progress = JSON.stringify({
      old: { progress: 300, duration: 1500, updatedAt: 1 },
    })
    expect(readMediaProgress('old')).toEqual({
      progress: 300,
      duration: 1500,
      finished: false,
    })
    expect(readMediaProgress('none')).toBeNull()
    markWatched('ep')
    expect(isWatched('ep')).toBe(true)
    expect(JSON.parse(store[WATCHED_STORAGE_KEY])[0].key).toBe('ep')
    unmarkWatched('ep')
    expect(isWatched('ep')).toBe(false)
  })

  it('零秒进度不算看完，markFinished 之后算看完', () => {
    stubStorage()
    const saver = useProgressSaver(() => '/tv/e1.mkv')
    saver.onTimeUpdate({
      target: { currentTime: 0, duration: 1500 },
    } as never)
    const zero = readMediaProgress('/tv/e1.mkv')
    expect(zero).toEqual({ progress: 0, duration: 1500, finished: false })
    expect(progressSeen(zero)).toBe(false)
    expect(
      spoilerHidden(true, ['/tv/e1.mkv'], new Set(), readMediaProgress)
    ).toBe(true)

    saver.markFinished({ duration: 1500 } as HTMLVideoElement)
    const done = readMediaProgress('/tv/e1.mkv')
    expect(done).toEqual({ progress: 0, duration: 1500, finished: true })
    expect(progressSeen(done)).toBe(true)
    expect(
      spoilerHidden(true, ['/tv/e1.mkv'], new Set(), readMediaProgress)
    ).toBe(false)
  })
})
