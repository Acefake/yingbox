/**
 * 视图域 view（ADR-0030）：服务端拼好页面数据给安卓原生端。取数走在线引擎（online 域），
 * 所以只在在线板块开启时登记（见 features.ts）。
 */
import { randomUUID } from 'node:crypto'

import cmsSitesFile from '../../../cms-sites.json'
import { channelOf } from '../../shared/contract/define'
import type {
  GetJsonResponse,
  StreamProbe,
  VodRequest,
  VodResponse,
} from '../../shared/contract/online'
import { view } from '../../shared/contract/view'
import type { DoubanMetadata } from '../../shared/douban/detail'
import type { DoubanPage, DoubanSubject } from '../../shared/douban/query'
import { isThumbSource } from '../../shared/media-url'
import type { ApiSite, CatSpiderSite } from '../../shared/online/types'
import { type DoubanItem, doubanSubjectId } from '../../shared/douban/item'
import type { HomeFeed } from '../../shared/view/home'
import type { DomainRegistry } from '../domains/registry'
import type { ServerEngine } from '../online/engine'
import type { Playback } from '../playback'
import { browsePage } from './browse'
import { type ProbeDeps, createProber } from './probe'
import { createUpdateChecker, githubReleases } from './app-update'
import { createSourceHealth } from './source-health'
import { searchCards } from './search'
import { composeHome, favoriteCards, recentCards } from './compose'
import {
  createSourceSessions,
  favoriteItemOf,
  resolveEpisode,
  viewDetail,
} from './detail'
import { resumeView } from './resume'
import { type HomeDeps, buildHomeFeed, isCompleteHome, thumbPath } from './home'
import type { SourceDeps } from './sources'

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

/** 插件调用最长等多久 */
const VOD_TIMEOUT_MS = 45_000

/** 内置 CMS 站点（与桌面默认启用的相同；用户自己的启用列表等设置同步后接入） */
const CMS_SITES: ApiSite[] = (cmsSitesFile as { sites: ApiSite[] }).sites

/** 引擎调用 → 选源与解析播放地址的 I/O */
export function engineSourceDeps(engine: ServerEngine): SourceDeps & ProbeDeps {
  const online = (method: string, args: unknown[]): Promise<unknown> =>
    engine.invoke(channelOf('online', method), args)
  // 插件调用没有统一的请求超时：与桌面 use-vod-parser 一样 45 秒没回就当失败
  const vod = (request: VodRequest): Promise<VodResponse> =>
    Promise.race([
      online('vod', [request]) as Promise<VodResponse>,
      new Promise<VodResponse>(resolve =>
        setTimeout(
          () => resolve({ success: false, error: '插件超时' }),
          VOD_TIMEOUT_MS
        ).unref?.()
      ),
    ])
  return {
    cmsSites: () => CMS_SITES,
    pluginSites: () => online('sites', []) as Promise<CatSpiderSite[]>,
    getJson: (url, timeoutMs) =>
      online('getJson', [url, { timeoutMs }]) as Promise<GetJsonResponse>,
    vod,
    playinfo: async fields => {
      const r = await vod({ action: 'getPlayinfo', ...fields })
      return r.success ? r.data : null
    },
    resolvePage: url => online('resolvePage', [url]) as Promise<string>,
    probeStream: url => online('probeStream', [url]) as Promise<StreamProbe>,
  }
}

/** 搜索与选源的站点清单里去掉不用的（用户屏蔽的、体检不通的；每次请求现读，改了立即生效） */
export function withoutHidden<T extends SourceDeps>(
  deps: T,
  hidden: () => ReadonlySet<string>
): T {
  return {
    ...deps,
    cmsSites: () => deps.cmsSites().filter(site => !hidden().has(site.name)),
    pluginSites: async () =>
      (await deps.pluginSites()).filter(site => !hidden().has(site.name)),
  }
}

/** 服务起来后多久开始第一轮体检（给引擎留出启动时间） */
const HEALTH_START_DELAY_MS = 3_000

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

/** 视图要读写的播放记录（服务端 playback，ADR-0031） */
export type ViewRecords = Pick<
  Playback,
  | 'continueList'
  | 'favorites'
  | 'toggleFavorite'
  | 'blockedSites'
  | 'setSiteBlocked'
  | 'sourceHealth'
  | 'saveSourceHealth'
>

/** 登记视图域；播放记录每次请求现读 */
export function registerView(
  registry: DomainRegistry,
  engine: ServerEngine,
  records: ViewRecords
): void {
  const deps = engineHomeDeps(engine)
  const feed = cachedHome(() => buildHomeFeed(deps))
  const engineSources = engineSourceDeps(engine)
  // 体检：全部源跑一遍，通的启用、不通的停用（ADR-0036）
  const health = createSourceHealth(engineSources, {
    read: () => records.sourceHealth(),
    write: record => records.saveSourceHealth(record),
  })
  // 搜索、选源、自动换源跳过：用户屏蔽的 + 体检不通的
  const hidden = (): ReadonlySet<string> =>
    new Set([...records.blockedSites(), ...health.disabled()])
  const sourceDeps = withoutHidden(engineSources, hidden)
  const sessions = createSourceSessions(
    sourceDeps,
    Date.now,
    randomUUID,
    createProber(sourceDeps),
    hidden
  )
  const checkUpdate = createUpdateChecker(githubReleases())
  // 服务起来后在后台跑第一轮（与桌面启动轮次一样），失败不影响别的功能
  setTimeout(() => void health.start(), HEALTH_START_DELAY_MS).unref?.()
  registry.implement(view, {
    home: async () =>
      composeHome(
        await feed(),
        records.continueList(),
        records.favorites(),
        Date.now()
      ),
    recent: () =>
      recentCards(records.continueList(), Date.now(), async (id, kind) => {
        const cover = (await deps.metadata(id, kind))?.cover
        return cover && isThumbSource(cover) ? thumbPath(cover, 480) : null
      }),
    favorites: () => favoriteCards(records.favorites()),
    browse: (_, target, start) => browsePage(target, start, deps),
    detail: async (_, id, kind) => {
      const meta = await deps.metadata(id, kind).catch(() => null)
      const favorite = records
        .favorites()
        .some(item => doubanSubjectId(item.url) === id)
      return meta ? viewDetail(meta, favorite) : null
    },
    favorite: async (_, id, kind, on) => {
      // 比对按豆瓣 ID：旧收藏的地址可能是 m.douban.com、http 或没有末尾斜杠
      const saved = (): DoubanItem[] =>
        records.favorites().filter(item => doubanSubjectId(item.url) === id)
      // 取消：不需要豆瓣详情，同步删掉所有匹配项（豆瓣限流时也能删）
      if (!on) {
        for (const item of saved()) records.toggleFavorite(item)
        return false
      }
      if (saved().length) return true
      const meta = await deps.metadata(id, kind)
      if (!meta) throw new Error('取不到豆瓣详情，稍后再试')
      // 等详情期间可能已被另一个请求收藏：再查一次，查与写之间不再有 await
      if (saved().length) return true
      return records.toggleFavorite(favoriteItemOf(meta))
    },
    search: (_, keyword) => searchCards(keyword, sourceDeps),
    appUpdate: (_, current, abis) => checkUpdate(current, abis),
    sourceHealth: () => health.status(),
    recheckSources: () => {
      void health.start()
      return health.status()
    },
    blockedSites: () => records.blockedSites(),
    blockSite: (_, name, on) => records.setSiteBlocked(name, on),
    sourcesStart: (_, title) => sessions.start(title),
    sources: (_, id) => sessions.get(id),
    resume: (_, id) => {
      const record = records.continueList().find(r => r.id === id)
      return record ? resumeView(record) : null
    },
    resolve: (_, episode) =>
      resolveEpisode(
        {
          ...episode,
          ext: episode.ext
            ? (JSON.parse(episode.ext) as Record<string, unknown>)
            : null,
        },
        sourceDeps
      ),
  })
}
