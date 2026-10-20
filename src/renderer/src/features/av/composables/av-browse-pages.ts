/**
 * AV 浏览的三种取页方式（插件 / MissAV / CMS）。每个函数先发请求，返回一个「整理函数」：
 * 由调用方在确认请求仍有效后再执行，整理函数里才读取当前分类、写分类缓存。
 */
import type { Ref } from 'vue'
import { getJson, useVODParser } from '@/features/online'
import { listMissav } from '../api/missav'
import {
  type AvEntry,
  type BrowseCacheEntry,
  type BrowseCategory,
  type BrowseSort,
  createBrowseUrl,
  mergeCategories,
  missavSlug,
  toCmsItems,
  toMissavItems,
  toPluginItems,
} from '../utils/av-catalog'

export function createPageFetchers(state: {
  sourceApi: Ref<string>
  categories: Ref<BrowseCategory[]>
  categoryId: Ref<number | null>
  categoryName: Ref<string>
  sort: Ref<BrowseSort>
  categoryCache: Ref<Record<string, BrowseCategory[]>>
}) {
  const { getCards } = useVODParser()
  const {
    sourceApi,
    categories,
    categoryId,
    categoryName,
    sort,
    categoryCache,
  } = state

  /** 插件源分类内容：走 CatSpider 的 getCards；下一页存在与否只看这页有没有内容。 */
  const fetchPluginPage = async (
    entry: AvEntry,
    ext: Record<string, any>,
    p: number
  ) => {
    const r = await getCards({
      siteName: entry.name,
      url: ext.url,
      ext: JSON.stringify(ext),
      page: p,
    })
    return (): BrowseCacheEntry => {
      if (!r.success || !r.data)
        throw new Error(r.error || `${entry.name} 没有返回可用内容`)
      const list = r.data.list || r.data.data?.list || []
      const items = toPluginItems(list, entry.name)
      return {
        items,
        pageCount: items.length ? p + 1 : p,
        total: 0,
        categories: categories.value,
      }
    }
  }

  const fetchMissavPage = async (p: number) => {
    const slug = missavSlug(categories.value, categoryName.value)
    const result = await listMissav(slug, p, sort.value)
    return (): BrowseCacheEntry => ({
      items: toMissavItems(result.items, categoryName.value),
      pageCount: result.pageCount,
      total: 0,
      categories: categories.value,
    })
  }

  /** CMS 源：code=1 且有 list 才算成功；新出现的分类并入分类栏。 */
  const fetchCmsPage = async (source: AvEntry, p: number) => {
    const url = createBrowseUrl(source.api, p, categoryId.value)
    const data = await getJson<any>(url, { timeoutMs: 10000 }).then(
      (d: any) => (d.code === 1 && Array.isArray(d.list) ? d : null),
      () => null
    )
    return (): BrowseCacheEntry => {
      if (!data) throw new Error('所有启用数据源均未返回可用内容')
      const items = toCmsItems(data.list, source.name)
      categories.value = mergeCategories(categories.value, items)
      if (sourceApi.value)
        categoryCache.value[sourceApi.value] = categories.value
      return {
        items,
        pageCount: Number(data.pagecount || 0),
        total: Number(data.total || 0),
        categories: categories.value,
      }
    }
  }

  return { fetchPluginPage, fetchMissavPage, fetchCmsPage }
}
