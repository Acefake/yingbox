import { describe, expect, it, vi } from 'vitest'
import type { LibraryItemNode } from '../src/shared/library/ipc'
import type { ContinueRecord } from '../src/renderer/src/features/player/continue/continue-rules'

vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => null,
  usesLibraryServer: () => false,
}))
vi.mock('../src/renderer/src/features/player', async () => {
  const rules =
    await import('../src/renderer/src/features/player/continue/continue-rules')
  return {
    replayOptions: rules.replayOptions,
    metaOf: rules.metaOf,
    openMediaPlayer: vi.fn(),
  }
})

import { currentLibraryReplay } from '../src/renderer/src/features/library/progress/resume-library'

describe('整理后继续播放', () => {
  const record: ContinueRecord = {
    id: 'movie:3',
    section: 'movie',
    key: '3',
    title: '电影',
    progress: 120,
    duration: 600,
    updatedAt: 10,
    replay: {
      filePath: 'E:/old.mkv',
      index: 0,
      playlist: [{ filePath: 'E:/old.mkv', library: { itemId: 3, fileId: 3 } }],
    },
  }
  const item: LibraryItemNode = {
    id: 3,
    libraryId: 1,
    type: 'movie',
    title: '电影',
    originalTitle: null,
    year: null,
    matchState: 'unmatched',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: null,
    addedAt: 0,
    updatedAt: 0,
    seasonNumber: null,
    episodeNumber: null,
    overview: null,
    logo: null,
    runtime: null,
    genres: [],
    airDate: null,
    metadata: null,
    files: [{ id: 3, kind: 'video', path: 'E:/new.mkv', size: 0, mtime: 0 }],
    children: [],
  }

  it('按文件 ID 取最新路径并保留进度', () => {
    const replay = currentLibraryReplay(record, item)
    expect(replay?.filePath).toBe('E:/new.mkv')
    expect(replay?.playlist?.[0].filePath).toBe('E:/new.mkv')
    expect(replay?.startAt).toBe(120)
  })

  it('文件已不在库中时不使用旧路径', () => {
    expect(currentLibraryReplay(record, { ...item, files: [] })).toBeNull()
  })

  it('旧记录没有文件 ID 时，单文件影片仍能找到整理后的文件', () => {
    const legacy = { ...record, replay: { filePath: 'E:/old.mkv' } }
    const replay = currentLibraryReplay(legacy, { ...item, id: 3 })
    expect(replay?.filePath).toBe('E:/new.mkv')
    expect(replay?.playlist?.[0].library).toEqual({ itemId: 3, fileId: 3 })
  })
})
