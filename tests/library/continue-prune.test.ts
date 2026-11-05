// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContinueRecord } from '../../src/shared/playback/continue-rules'

const getItem = vi.fn<(id: number) => Promise<unknown>>()
/** 库 5 是番号库，库 1 是普通片库 */
const listLibraries = async (): Promise<{ id: number; source: string }[]> => [
  { id: 1, source: 'tmdb' },
  { id: 5, source: 'jav' },
]

vi.mock('../../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ getItem, listLibraries }),
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
    getItem.mockImplementation(async id =>
      id === 2 ? { id, libraryId: 1 } : null
    )

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

  it('番号库的作品被记成电影的记录清掉（不再串到电影页和首页），记对的保留', async () => {
    const store = await import('../../src/renderer/src/features/player')
    // 「@/features/player」的 mock 在多个用例间共用同一份存储，先清空
    store.removeContinueWhere(() => true)
    const { pruneMissingContinue } =
      await import('../../src/renderer/src/features/library/progress/continue-source')
    store.mergeContinue([
      record('movie', '6604'),
      record('jav', '6604'),
      record('movie', '7'),
    ])
    getItem.mockImplementation(async id => ({
      id,
      libraryId: id === 6604 ? 5 : 1,
    }))

    await pruneMissingContinue()

    expect(
      store
        .continueRecords()
        .value.map(r => r.id)
        .sort()
    ).toEqual(['jav:6604', 'movie:7'])
  })

  it('替换番号作品的记录时，清掉它在电影 / 剧集分区的旧记录', async () => {
    const store = await import('../../src/renderer/src/features/player')
    // 「@/features/player」的 mock 在多个用例间共用同一份存储，先清空
    store.removeContinueWhere(() => true)
    store.mergeContinue([record('movie', '6604'), record('tv', '6604')])

    store.replaceLibraryContinue(6604, 'jav', {
      ...record('jav', '6604'),
      updatedAt: 2,
    })

    expect(store.continueRecords().value.map(r => r.id)).toEqual(['jav:6604'])
  })
})
