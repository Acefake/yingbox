// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 长列表接线检查：这些列表的条数没有上限（滚动加载 / 聚合搜索 / 收藏 / 队列），
 * 必须走 UiVirtualGrid，不能退回一次性 v-for 全部渲染。
 */
const LONG_LISTS: Record<string, string[]> = {
  'features/av/views/AvView.vue': ['browse.sortedVideos.value'],
  'features/av/components/AvSearchResults.vue': ['groups'],
  'features/av/components/AvFavoritesView.vue': ['favorites'],
  'features/online/components/SearchTab.vue': ['vodResults', 'cmsResults'],
  'features/online/components/VodBrowse.vue': ['filteredCards'],
  'features/online/components/LibraryCollection.vue': ['filteredItems'],
  'features/online/components/DoubanBrowse.vue': ['items'],
  'features/download/components/DownloadsView.vue': ['rows'],
  'features/library/actors/ActorsView.vue': ['actors'],
  'features/netdisk/views/NetdiskView.vue': ['shareRows', 'magnetRows'],
}

describe('长列表走虚拟网格', () => {
  for (const [file, lists] of Object.entries(LONG_LISTS)) {
    it(file, () => {
      const source = readFileSync(`src/renderer/src/${file}`, 'utf8')
      for (const list of lists) {
        expect(source).toContain(`:items="${list}"`)
        expect(source).not.toMatch(
          new RegExp(`v-for="\\w+ in ${list.replace(/\./g, '\\.')}"`)
        )
      }
      expect(source).toMatch(/<UiVirtualGrid\b/)
    })
  }
})
