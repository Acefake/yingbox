import { describe, expect, it, vi } from 'vitest'
import { parseDoubanMetadata } from '../src/engine/online/douban-metadata'
import type { DoubanMetadata } from '../src/shared/douban/detail'

const mocks = vi.hoisted(() => ({ tmdb: vi.fn(), doubanMetadata: vi.fn() }))
vi.mock('@/features/online/api/online', () => mocks)
import { useTmdbDetail } from '@/features/online/composables/use-tmdb-detail'

const metadata = (id: string): DoubanMetadata => ({
  ...parseDoubanMetadata({ id, title: `影片${id}`, intro: '简介' })!,
  images: [
    {
      thumb: 'https://img1.doubanio.com/1.jpg',
      full: 'https://img1.doubanio.com/1.jpg',
    },
  ],
})

describe('豆瓣详情不依赖 TMDB', () => {
  it('未配置令牌时展示豆瓣详情与剧照', async () => {
    mocks.tmdb.mockResolvedValue(null)
    mocks.doubanMetadata.mockResolvedValue(metadata('1'))
    const state = useTmdbDetail()
    await state.fetchTmdb('影片1', 'movie', { id: '1', kind: 'movie' })
    expect(state.douban.value?.intro).toBe('简介')
    expect(state.images.value).toHaveLength(1)
    expect(state.detail.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })
  it('TMDB 仍在等待时，豆瓣详情已经可见', async () => {
    let finish!: (value: null) => void
    mocks.tmdb.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    mocks.doubanMetadata.mockResolvedValue(metadata('1'))
    const state = useTmdbDetail()
    const load = state.fetchTmdb('影片1', 'movie', { id: '1', kind: 'movie' })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(state.loading.value).toBe(false)
    expect(state.douban.value?.id).toBe('1')
    finish(null)
    await load
  })
  it('切换条目后旧豆瓣详情晚到也不会覆盖新条目', async () => {
    mocks.tmdb.mockResolvedValue(null)
    let finish!: (value: ReturnType<typeof metadata>) => void
    mocks.doubanMetadata
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      .mockResolvedValue(metadata('2'))
    const state = useTmdbDetail()
    const old = state.fetchTmdb('影片1', 'movie', { id: '1', kind: 'movie' })
    state.reset()
    await state.fetchTmdb('影片2', 'movie', { id: '2', kind: 'movie' })
    finish(metadata('1'))
    await old
    expect(state.douban.value?.id).toBe('2')
  })
})
