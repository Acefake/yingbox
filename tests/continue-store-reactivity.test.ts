// @vitest-environment jsdom
import { computed, watchEffect } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/incognito', () => ({ isIncognito: () => false }))

import {
  continueRecords,
  finishContinue,
  removeContinue,
  removeContinueWhere,
  startContinue,
  updateContinue,
} from '../src/renderer/src/features/player/continue/continue-store'

beforeEach(() => {
  removeContinueWhere(() => true)
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

const start = (): string =>
  startContinue(
    { section: 'online', key: 'series', title: '剧集' },
    {
      index: 0,
      playlist: [
        { url: 'https://example.invalid/1.m3u8', name: '第 1 集' },
        { url: 'https://example.invalid/2.m3u8', name: '第 2 集' },
      ],
    }
  )

describe('继续播放的响应式更新', () => {
  it('进度保存后订阅者收到新进度，上一份快照和存储中的播放列表保持正确', () => {
    const id = start()
    const records = continueRecords()
    const previous = records.value
    const seen: number[] = []
    const stop = watchEffect(() => seen.push(records.value[0].progress), {
      flush: 'sync',
    })
    try {
      updateContinue(id, { index: 0, progress: 120, duration: 1200 })
      expect(seen).toEqual([0, 120])
      expect(previous[0].progress).toBe(0)
      expect(JSON.parse(localStorage.getItem('continue_watching')!)).toEqual(
        records.value
      )
      expect(records.value[0].replay.playlist).toHaveLength(2)
    } finally {
      stop()
    }
  })

  it('标记本集看完更新下一集，移除记录使派生列表立即清空', () => {
    const id = start()
    const records = continueRecords()
    const episodes = computed(() =>
      records.value.map(record => record.replay.index)
    )
    expect(episodes.value).toEqual([0])
    finishContinue(id)
    expect(episodes.value).toEqual([1])
    expect(records.value[0].nextUp).toBe(true)
    removeContinue(id)
    expect(episodes.value).toEqual([])
  })

  it('其他窗口更新存储后，列表和派生进度同步替换', () => {
    const id = start()
    const records = continueRecords()
    const progress = computed(() => records.value[0]?.progress ?? 0)
    expect(progress.value).toBe(0)
    const next = JSON.stringify([
      { ...records.value[0], progress: 300, duration: 1200 },
    ])
    localStorage.setItem('continue_watching', next)
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'continue_watching', newValue: next })
    )
    expect(progress.value).toBe(300)
    expect(records.value[0].id).toBe(id)
  })
})
