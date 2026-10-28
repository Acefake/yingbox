/**
 * AV 浏览的两种取页方式（插件 / CMS）。每个函数先发请求，返回一个「整理函数」：
 * 由调用方在确认请求仍有效后再执行，整理函数里才读取当前分类、写分类缓存。
 */
import type { Ref } from 'vue'
import { getJson, useVODParser } from '@/features/online'
import { type PluginExt, getVodList } from '@/utils/vod-data'
import {
  type AvEntry,
  type BrowseCacheEntry,
  type BrowseCategory,
  createBrowseUrl,
  mergeCategories,
  toCmsItems,
  toPluginItems,
} from '../utils/av-catalog'

/** AV CMS 列表接口的返回（ac=videolist）：code=1 表示成功 */
interface CmsPage {
  code?: number
  list?: unknown[]
  pagecount?: number | string
  total?: number | string
}

/** 两种数据源的分页请求：先发请求，返回的函数在确认请求仍有效后才写状态 */
export interface AvPageFetchers {
  fetchPluginPage: (
    entry: AvEntry,
    ext: PluginExt,
    p: number
  ) => Promise<() => BrowseCacheEntry>
  fetchCmsPage: (source: AvEntry, p: number) => Promise<() => BrowseCacheEntry>
}

export function createPageFetchers(state: {
  sourceApi: Ref<string>
  categories: Ref<BrowseCategory[]>
  categoryId: Ref<number | null>
  categoryCache: Ref<Record<string, BrowseCategory[]>>
}): AvPageFetchers {
  const { getCards } = useVODParser()
  const { sourceApi, categories, categoryId, categoryCache } = state

  /** 插件源分类内容：走 CatSpider 的 getCards；下一页存在与否只看这页有没有内容。 */
  const fetchPluginPage = async (
    entry: AvEntry,
    ext: PluginExt,
    p: number
  ): Promise<() => BrowseCacheEntry> => {
    const r = await getCards({
      siteName: entry.name,
      url: typeof ext.url === 'string' ? ext.url : undefined,
      ext: JSON.stringify(ext),
      page: p,
    })
    return (): BrowseCacheEntry => {
      if (!r.success || !r.data)
        throw new Error(r.error || `${entry.name} 没有返回可用内容`)
      const items = toPluginItems(getVodList(r.data), entry.name)
      return {
        items,
        pageCount: items.length ? p + 1 : p,
        total: 0,
        categories: categories.value,
      }
    }
  }

  /** CMS 源：code=1 且有 list 才算成功；新出现的分类并入分类栏。 */
  const fetchCmsPage = async (source: AvEntry, p: number) => {
    const url = createBrowseUrl(source.api, p, categoryId.value)
    const data = await getJson<CmsPage>(url, { timeoutMs: 10000 }).then(
      d => (d.code === 1 && Array.isArray(d.list) ? d : null),
      () => null
    )
    return (): BrowseCacheEntry => {
      if (!data) throw new Error('所有启用数据源均未返回可用内容')
      const items = toCmsItems(data.list ?? [], source.name)
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

  return { fetchPluginPage, fetchCmsPage }
}
