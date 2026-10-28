/**
 * 在线详情换条目时，上一部还在路上的 TMDB 结果不能落到新条目上（useTmdbDetail 按世代丢弃旧结果）。
 */
import { describe, expect, it, vi } from 'vitest'

type Pending = { path: string; resolve: (value: unknown) => void }
const pending: Pending[] = []
vi.mock('../src/renderer/src/features/online/api/online', () => ({
  tmdb: (path: string) =>
    new Promise(resolve => pending.push({ path, resolve })),
  doubanMetadata: async () => null,
}))

const { useTmdbDetail } =
  await import('../src/renderer/src/features/online/composables/use-tmdb-detail')

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** 依次应答所有挂起的请求：搜索给 id，详情给片名 */
async function answer(id: number, title: string): Promise<void> {
  while (pending.length) {
    const next = pending.shift()!
    if (next.path.startsWith('/search/'))
      next.resolve({ results: [{ id, title }] })
    else if (next.path.endsWith('/credits')) next.resolve({ cast: [] })
    else next.resolve({ id, title, images: { backdrops: [] } })
    await flush()
  }
}

describe('useTmdbDetail 换条目', () => {
  it('旧条目的结果晚到时丢弃，详情是新条目的', async () => {
    const tmdb = useTmdbDetail()
    const first = tmdb.fetchTmdb('旧片', 'movie')
    const oldSearch = pending.shift()!
    tmdb.reset()
    const second = tmdb.fetchTmdb('新片', 'movie')
    await answer(2, '新片')
    await second
    oldSearch.resolve({ results: [{ id: 1 }] })
    await flush()
    await answer(1, '旧片')
    await first
    expect(tmdb.detail.value).toMatchObject({ id: 2, title: '新片' })
    expect(tmdb.loading.value).toBe(false)
  })
})
