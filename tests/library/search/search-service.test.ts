import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const locked = vi.hoisted(() => new Set<string>())
vi.mock('@/features/section-lock', () => ({
  isPathLocked: (path: string) => locked.has(path),
}))
import type { LibraryItemSummary } from '../../../src/shared/library/ipc'
import type {
  RecallBatch,
  SearchRequest,
} from '../../../src/renderer/src/features/library/search/types'

const { query, actors, status, visual, index } = vi.hoisted(() => ({
  query: vi.fn(),
  actors: vi.fn(),
  status: vi.fn(),
  visual: vi.fn(),
  index: vi.fn(),
}))
vi.mock('../../../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({
    query,
    actors: { list: actors },
    visual: { status, search: visual, index },
  }),
}))
vi.mock('@/features/player', () => ({ continueRecords: () => ref([]) }))
import { searchLibrary } from '../../../src/renderer/src/features/library/search/search-service'

const film: LibraryItemSummary = {
  id: 1,
  libraryId: 1,
  type: 'movie',
  title: '测试',
  originalTitle: null,
  year: 2020,
  matchState: 'locked',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 0,
  updatedAt: 0,
}
const request = (signal = new AbortController().signal): SearchRequest => ({
  text: '测试',
  scope: 'all',
  signal,
})
beforeEach(() => {
  locked.clear()
  vi.resetAllMocks()
  query.mockResolvedValue({ items: [film], total: 1 })
  actors.mockResolvedValue({ items: [] })
  status.mockResolvedValue({ runtime: true, model: 'ready', indexed: 1 })
  visual.mockResolvedValue([
    {
      itemId: 1,
      title: '测试',
      score: 0.8,
      image: 'frame',
      frame: { fileId: 2, at: 30 },
    },
  ])
})
describe('统一搜索并行召回', () => {
  it('慢画面不阻塞片名结果', async () => {
    let finish!: (batch: RecallBatch) => void
    const published: RecallBatch[] = []
    const pending = searchLibrary(request(), batch => published.push(batch), [
      async () => ({
        kind: 'title',
        candidates: [{ item: film, reason: '片名' }],
      }),
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    ])
    await Promise.resolve()
    await Promise.resolve()
    expect(published[0].kind).toBe('title')
    finish({ kind: 'visual', candidates: [] })
    await pending
  })
  it('取消后迟到结果不再发布', async () => {
    let finish!: (batch: RecallBatch) => void
    const controller = new AbortController(),
      publish = vi.fn()
    const pending = searchLibrary(request(controller.signal), publish, [
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    ])
    controller.abort()
    finish({ kind: 'title', candidates: [] })
    await pending
    expect(publish).not.toHaveBeenCalled()
  })
  it('单路错误不阻止其他路，且给出降级提示', async () => {
    const published: RecallBatch[] = []
    await searchLibrary(request(), batch => published.push(batch), [
      async () => {
        throw new Error('offline')
      },
      async () => ({
        kind: 'people',
        candidates: [{ item: film, reason: '人物' }],
      }),
    ])
    expect(published.some(batch => batch.message)).toBe(true)
    expect(
      published.find(batch => batch.kind === 'people')?.candidates
    ).toHaveLength(1)
  })
  it('普通范围不查询番号演员库与 CLIP', async () => {
    await searchLibrary(request(), () => {})
    expect(actors).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(visual).not.toHaveBeenCalled()
    for (const [params] of query.mock.calls) expect(params.source).toBe('tmdb')
  })
  it('私密范围使用就绪 CLIP，并带回时间点；绝不自动建立索引', async () => {
    const published: RecallBatch[] = []
    await searchLibrary({ ...request(), scope: 'jav' }, batch =>
      published.push(batch)
    )
    expect(
      published.find(batch => batch.kind === 'visual')?.candidates[0].visual
        ?.frame
    ).toEqual({ fileId: 2, at: 30 })
    expect(index).not.toHaveBeenCalled()
    for (const [params] of query.mock.calls) expect(params.source).toBe('jav')
  })
  it('模型未下载时继续提供片名结果，不发起画面推理', async () => {
    status.mockResolvedValue({ runtime: true, model: 'missing', indexed: 0 })
    const published: RecallBatch[] = []
    await searchLibrary({ ...request(), scope: 'jav' }, batch =>
      published.push(batch)
    )
    expect(visual).not.toHaveBeenCalled()
    expect(index).not.toHaveBeenCalled()
    expect(
      published.find(batch => batch.kind === 'title')?.candidates
    ).toHaveLength(1)
    expect(
      published.find(batch => batch.kind === 'visual')?.message
    ).toBeTruthy()
  })
})

it('锁定板块不参与全局搜索，指定锁定范围不发起查询', async () => {
  locked.add('/tv')
  await searchLibrary(request(), () => {})
  for (const [params] of query.mock.calls)
    expect(params.types).toEqual(['movie'])
  query.mockClear()
  const publish = vi.fn()
  await searchLibrary({ ...request(), scope: 'tv' }, publish)
  expect(query).not.toHaveBeenCalled()
  expect(publish.mock.calls[0][0].message).toContain('锁定')
})
