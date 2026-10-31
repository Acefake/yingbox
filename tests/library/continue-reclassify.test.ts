// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('类型纠正后的继续播放', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('替换旧分区但不覆盖较新的当前进度', async () => {
    const store =
      await import('../../src/renderer/src/features/player/continue/continue-store')
    const old = {
      id: 'tv:12',
      section: 'tv' as const,
      key: '12',
      title: '作品',
      replay: {},
      progress: 30,
      duration: 100,
      updatedAt: 30,
    }
    const current = {
      ...old,
      id: 'movie:12',
      section: 'movie' as const,
      progress: 80,
      updatedAt: 80,
    }
    store.mergeContinue([old, current])
    store.replaceLibraryContinue(12, 'movie', {
      ...current,
      progress: 50,
      updatedAt: 50,
    })
    expect(store.continueRecords().value).toEqual([current])
  })
})
