// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContinueRecord } from '../../src/renderer/src/features/player/continue/continue-rules'

const getItem = vi.fn<(id: number) => Promise<unknown>>()

vi.mock('../../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ getItem }),
  usesLibraryServer: () => false,
}))
vi.mock('../../src/renderer/src/features/player', async () => {
  const store =
    await import('../../src/renderer/src/features/player/continue/continue-store')
  return store
})
vi.mock('../../src/renderer/src/features/autograb', () => ({
  autograbAvailable: true,
}))
vi.mock('../../src/renderer/src/services/library-server', () => ({
  serverFileUrl: (id: number) => `https://nas/media/files/${id}`,
}))
vi.mock('../../src/renderer/src/features/library/api/images', () => ({
  itemImage: (url: string | null) => url,
}))
vi.mock('../../src/renderer/src/features/library/state/use-libraries', () => ({
  findLibrary: () => undefined,
}))

type Section = 'movie' | 'tv' | 'jav' | 'online' | 'av'

function record(section: Section, key: string): ContinueRecord {
  return {
    id: `${section}:${key}`,
    section,
    key,
    title: `作品 ${key}`,
    replay: {},
    progress: 30,
    duration: 100,
    updatedAt: 1,
  }
}

describe('继续播放：清掉片库里已不存在的作品', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    getItem.mockReset()
  })

  it('片库答「没有」的记录被清掉，还在的、在线 / AV 的保留，也不记墓碑', async () => {
    const store =
      await import('../../src/renderer/src/features/player/continue/continue-store')
    const { pruneMissingContinue } =
      await import('../../src/renderer/src/features/library/progress/continue-source')
    store.mergeContinue([
      record('movie', '1'),
      record('tv', '2'),
      record('jav', '3'),
      record('online', 'src:9'),
      record('av', '4'),
    ])
    getItem.mockImplementation(async id => (id === 2 ? { id } : null))

    await pruneMissingContinue()

    expect(store.continueRecords().value.map(r => r.id)).toEqual(
      expect.arrayContaining(['tv:2', 'online:src:9', 'av:4'])
    )
    expect(store.continueRecords().value).toHaveLength(3)
    expect(localStorage.getItem('continue_removed')).toBeNull()
  })

  it('查询出错时记录留着（引擎没起来不能当成条目没了）', async () => {
    const store =
      await import('../../src/renderer/src/features/player/continue/continue-store')
    const { pruneMissingContinue } =
      await import('../../src/renderer/src/features/library/progress/continue-source')
    store.mergeContinue([record('movie', '1')])
    getItem.mockRejectedValue(new Error('引擎未就绪'))

    await pruneMissingContinue()

    expect(store.continueRecords().value.map(r => r.id)).toEqual(['movie:1'])
  })
})
