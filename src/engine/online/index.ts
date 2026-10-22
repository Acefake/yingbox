/**
 * 在线域的引擎实现：CatSpider 插件、通用 JSON GET、豆瓣浏览与预告片、播放页解析。
 */
import type { NetClient } from '../../shared/net/client'
import {
  type HostBreaker,
  type HostTrip,
  HostUnavailableError,
  createHostBreaker,
  hostOf,
  pathScope,
} from '../../shared/net/host-breaker'
import {
  type CatSpiderSite,
  type VodRequest,
  type VodResponse,
  online,
} from '../../shared/contract/online'
import type { EngineContext, EngineHandlers } from '../rpc'
import { runCatSpider } from './catspider'
import { type DoubanBrowse, createDoubanBrowse } from './douban-browse'
import { type DoubanTrailers, createDoubanTrailers } from './douban-trailer'
import { type PluginStorage, createPluginStorage } from './plugin-storage'
import sitesFile from './vod-sites.json'

/** 内置站点表（只保留解析器支持的 type 3）。 */
export const SITES: CatSpiderSite[] = (
  sitesFile.sites as Array<Partial<CatSpiderSite>>
).filter(
  (s): s is CatSpiderSite =>
    s.type === 3 && typeof s.name === 'string' && typeof s.ext === 'string'
)

const MEDIA_URL = /\.(m3u8|mp4|flv)(\?|#|$)/i
const M3U8_IN_HTML = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i

/** 从播放页 HTML 中找出第一个 m3u8 地址。 */
export function findM3u8(html: string): string | undefined {
  return html.match(M3U8_IN_HTML)?.[0]
}

/** TMDB v3 接口根地址。 */
const TMDB_API = 'https://api.themoviedb.org/3'

/** 在线域依赖。 */
export interface OnlineDeps {
  net: NetClient
  loadPlugin: (url: string) => Promise<string>
  /** 插件请求的熔断（主机 + 路径类别）；缺省新建一份不落盘的（30 分钟冷却、连续 3 次失败） */
  breaker?: HostBreaker
  /** 插件 $cache 的存储（按插件隔离）；缺省只在内存里，跨调用共用、不跨重启 */
  pluginStorage?: PluginStorage
  /** 豆瓣预告片（内存 + 落盘缓存、熔断）；缺省新建一份只在内存里的 */
  doubanTrailers?: DoubanTrailers
  /** 豆瓣浏览（内存缓存、熔断）；缺省按 net 新建 */
  doubanBrowse?: DoubanBrowse
  log?: (line: string) => void
}

/** 插件脚本下载失败后多久内不再重试同一个脚本地址：5 分钟 */
const PLUGIN_RETRY_MS = 5 * 60 * 1000

/** 熔断严重程度：同一次调用碰到多个时回报最严重的那个。 */
const TRIP_RANK = { blocked: 3, challenge: 2, unreachable: 1, plugin: 0 }

const worse = (a: HostTrip | undefined, b: HostTrip): HostTrip =>
  !a || TRIP_RANK[b.reason] > TRIP_RANK[a.reason] ? b : a

/** 插件动作需要的参数：去掉 action / siteName，search 统一成 {text, page}。 */
function pluginArgs(request: VodRequest): Record<string, unknown> {
  const { action, siteName: _site, ...rest } = request
  if (action === 'search' || action === 'parse') {
    return {
      text: action === 'parse' ? rest.videoID : (rest.keyword ?? rest.text),
      page: rest.page ?? 1,
    }
  }
  if (action === 'getCards' && rest.page == null) return { ...rest, page: 1 }
  return rest
}

/** 创建在线域 handlers。 */
export function createOnlineHandlers(
  deps: OnlineDeps
): EngineHandlers<typeof online> {
  const breaker = deps.breaker ?? createHostBreaker({ scopeOf: pathScope })
  const pluginStorage = deps.pluginStorage ?? createPluginStorage()
  const trailers =
    deps.doubanTrailers ?? createDoubanTrailers({ net: deps.net })
  const douban = deps.doubanBrowse ?? createDoubanBrowse({ net: deps.net })
  /** 下载失败的插件脚本：地址 → 失败时间；冷却期内直接判失败 */
  const pluginFailures = new Map<string, number>()
  const loadPlugin = async (url: string): Promise<string> => {
    const failedAt = pluginFailures.get(url)
    if (failedAt !== undefined && Date.now() - failedAt < PLUGIN_RETRY_MS)
      throw new HostUnavailableError({
        host: hostOf(url),
        reason: 'plugin',
        until: failedAt + PLUGIN_RETRY_MS,
      })
    try {
      const code = await deps.loadPlugin(url)
      pluginFailures.delete(url)
      return code
    } catch {
      const now = Date.now()
      pluginFailures.set(url, now)
      throw new HostUnavailableError({
        host: hostOf(url),
        reason: 'plugin',
        until: now + PLUGIN_RETRY_MS,
      })
    }
  }

  return {
    sites: () => SITES,

    async resetBlocks(ctx, host) {
      breaker.reset(host)
      if (host === undefined) pluginFailures.clear()
      else
        for (const url of pluginFailures.keys())
          if (hostOf(url) === hostOf(host)) pluginFailures.delete(url)
      await ctx.host('resetBrowserFetch', host)
    },

    async vod(ctx: EngineContext, request): Promise<VodResponse> {
      const site = SITES.find(s => s.name === request.siteName)
      if (!site)
        return { success: false, error: `Site not found: ${request.siteName}` }
      // parse 是旧接口：CatSpider 站点上等同于按番号搜索
      const action = request.action === 'parse' ? 'search' : request.action
      let unavailable: HostTrip | undefined
      const onTrip = (trip: HostTrip): void => {
        unavailable = worse(unavailable, trip)
      }
      try {
        const data = await runCatSpider(
          {
            net: deps.net,
            loadPlugin,
            browserFetch: url => ctx.host('browserFetch', url),
            breaker,
            onTrip,
            cache: pluginStorage.forPlugin(site.ext),
            log: deps.log,
          },
          site.ext,
          action,
          pluginArgs(request),
          site.patch
        )
        return unavailable
          ? { success: true, data, unavailable }
          : { success: true, data }
      } catch (error) {
        if (error instanceof HostUnavailableError) onTrip(error.trip)
        const failed = { success: false, error: (error as Error).message }
        return unavailable ? { ...failed, unavailable } : failed
      }
    },

    getJson: (_ctx, url, options = {}) =>
      deps.net.getJson(url, {
        headers: options.headers,
        timeoutMs: Math.min(Math.max(options.timeoutMs ?? 10000, 1000), 60000),
        ttlMs: 60_000,
      }),

    async tmdb(ctx, path, query = {}) {
      const token = await ctx.host('tmdbToken')
      if (!token) return null
      const target = new URL(`${TMDB_API}${path}`)
      for (const [key, value] of Object.entries(query))
        target.searchParams.set(key, String(value))
      return deps.net.getJson(String(target), {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 8000,
        ttlMs: 60_000,
      })
    },

    doubanTrailer: (_ctx, id, kind = 'movie') => trailers.get(id, kind),

    doubanBrowse: (_ctx, query, start) => douban.page(query, start),

    async resolvePage(_ctx, url) {
      if (!url || MEDIA_URL.test(url)) return url
      try {
        const page = await deps.net.getText(url, {
          timeoutMs: 8000,
          maxBytes: 4 * 1024 * 1024,
        })
        if (MEDIA_URL.test(page.url)) return page.url
        return findM3u8(page.text) ?? url
      } catch {
        return url
      }
    },
  }
}
