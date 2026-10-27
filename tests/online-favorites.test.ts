/**
 * 在线收藏是一份共享列表：「我的收藏」页清空后，首页（v-show 切页，组件一直挂着）
 * 再收藏一部时不会把清掉的条目写回去。存储走 @/utils/storage，存储不可用时不抛错。
 * test-affected: repo-wide
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DoubanItem } from '../src/renderer/src/features/online/types'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

const item = (url: string): DoubanItem =>
  ({ url, title: url, cover: `${url}.jpg` }) as unknown as DoubanItem

describe('在线收藏共享列表', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('清空后再收藏，只剩新收藏的一部', async () => {
    const favorites =
      await import('../src/renderer/src/features/online/composables/favorites')
    favorites.toggleFavorite(item('a'))
    expect(favorites.isFavorite(item('a'))).toBe(true)
    favorites.clearFavorites()
    expect(favorites.isFavorite(item('a'))).toBe(false)
    favorites.toggleFavorite(item('b'))
    expect(JSON.parse(localStorage.getItem('media_favorites')!)).toEqual([
      item('b'),
    ])
  })

  it('存储写入失败时不抛错', async () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    const storage = await import('../src/renderer/src/utils/storage')
    expect(storage.writeStoredText('k', 'v')).toBe(false)
    expect(storage.readStoredText('k')).toBeNull()
    expect(() => storage.removeStored('k')).not.toThrow()
  })

  it('首页与「我的收藏」页都改同一份收藏，不直接读写 localStorage', () => {
    const root = 'src/renderer/src/features/online/components/'
    const douban = readFileSync(`${root}DoubanBrowse.vue`, 'utf8')
    const collection = readFileSync(`${root}LibraryCollection.vue`, 'utf8')
    expect(douban).toContain("from '../composables/favorites'")
    expect(collection).toContain('clearFavorites()')
    expect(douban + collection).not.toMatch(/localStorage\./)
  })
})
