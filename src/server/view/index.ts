/**
 * 视图域 view（ADR-0030）：服务端拼好页面数据给安卓原生端。取数走在线引擎（online 域），
 * 所以只在在线板块开启时登记（见 features.ts）。
 */
import { channelOf } from '../../shared/contract/define'
import { view } from '../../shared/contract/view'
import type { DoubanMetadata } from '../../shared/douban/detail'
import type { DoubanPage, DoubanSubject } from '../../shared/douban/query'
import type { ContinueRecord } from '../../shared/playback/continue-rules'
import type { HomeFeed } from '../../shared/view/home'
import type { DomainRegistry } from '../domains/registry'
import type { ServerEngine } from '../online/engine'
import { composeHome } from './compose'
import { type HomeDeps, buildHomeFeed, isCompleteHome } from './home'

/** 首页结果缓存多久（引擎另有豆瓣页缓存；这里省掉补全的几十次请求） */
const HOME_TTL_MS = 10 * 60 * 1000
/** 有行没取到（网络未就绪、豆瓣熔断）时只缓存这么久，免得空首页挂 10 分钟 */
const PARTIAL_TTL_MS = 30 * 1000

/** 引擎调用 → 首页取数 */
export function engineHomeDeps(engine: ServerEngine): HomeDeps {
  const online = (method: string, args: unknown[]): Promise<unknown> =>
    engine.invoke(channelOf('online', method), args)
  return {
    browse: (query, start) =>
      online('doubanBrowse', [query, start]) as Promise<DoubanPage>,
    chart: () => online('doubanChart', []) as Promise<DoubanSubject[]>,
    metadata: (id, kind) =>
      online('doubanMetadata', [id, kind]) as Promise<DoubanMetadata | null>,
    search: (path, query) => online('tmdb', [path, query]),
  }
}

/** 带缓存的首页豆瓣部分：同一时间只拼一次；完整的结果缓存 HOME_TTL_MS，有缺行的缓存 PARTIAL_TTL_MS */
export function cachedHome(
  build: () => Promise<HomeFeed>,
  now: () => number = Date.now
): () => Promise<HomeFeed> {
  let cached: { until: number; value: HomeFeed } | null = null
  let pending: Promise<HomeFeed> | null = null
  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.value)
    pending ??= build()
      .then(value => {
        const ttl = isCompleteHome(value) ? HOME_TTL_MS : PARTIAL_TTL_MS
        cached = { until: now() + ttl, value }
        return value
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}

/** 登记视图域；continueRecords 读服务端播放记录（ADR-0031），每次请求现读 */
export function registerView(
  registry: DomainRegistry,
  engine: ServerEngine,
  continueRecords: () => ContinueRecord[]
): void {
  const deps = engineHomeDeps(engine)
  const feed = cachedHome(() => buildHomeFeed(deps))
  registry.implement(view, {
    home: async () => composeHome(await feed(), continueRecords(), Date.now()),
  })
}
