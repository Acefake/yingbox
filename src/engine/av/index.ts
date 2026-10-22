/**
 * AV 域的引擎实现：MissAV 目录（2 分钟缓存）与播放地址解析。
 */
import type { NetClient } from '../../shared/net/client'
import type { AvCatalogPage, av } from '../../shared/contract/av'
import type { EngineHandlers } from '../rpc'
import { listCatalog, resolveStream } from './missav'

const LIST_TTL_MS = 2 * 60 * 1000

/** 创建 AV 域 handlers。 */
export function createAvHandlers(
  net: NetClient,
  now: () => number = Date.now
): EngineHandlers<typeof av> {
  const cache = new Map<string, { at: number; page: AvCatalogPage }>()
  return {
    async list(ctx, category, page, sort) {
      const key = `${category}|${page}|${sort}`
      const hit = cache.get(key)
      if (hit && now() - hit.at < LIST_TTL_MS) return hit.page
      const result = await listCatalog(
        {
          net,
          browserFetch: url => ctx.host('browserFetch', url),
        },
        category,
        page,
        sort
      )
      if (cache.size > 40) cache.clear()
      cache.set(key, { at: now(), page: result })
      return result
    },
    resolve: (ctx, input) =>
      resolveStream(
        {
          net,
          browserFetch: url => ctx.host('browserFetch', url),
        },
        input
      ),
  }
}
