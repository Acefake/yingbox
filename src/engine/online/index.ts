/**
 * 在线域的引擎实现：CatSpider 插件、通用 JSON GET、播放页解析。
 */
import type { NetClient } from '../../shared/net/client'
import {
  type CatSpiderSite,
  type VodRequest,
  type VodResponse,
  online,
} from '../../shared/contract/online'
import type { EngineContext, EngineHandlers } from '../rpc'
import { runCatSpider } from './catspider'
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

/** 在线域依赖。 */
export interface OnlineDeps {
  net: NetClient
  loadPlugin: (url: string) => Promise<string>
  log?: (line: string) => void
}

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
  return {
    sites: () => SITES,

    async vod(ctx: EngineContext, request): Promise<VodResponse> {
      const site = SITES.find(s => s.name === request.siteName)
      if (!site)
        return { success: false, error: `Site not found: ${request.siteName}` }
      // parse 是旧接口：CatSpider 站点上等同于按番号搜索
      const action = request.action === 'parse' ? 'search' : request.action
      try {
        const data = await runCatSpider(
          {
            net: deps.net,
            loadPlugin: deps.loadPlugin,
            browserFetch: url => ctx.host('browserFetch', url),
            log: deps.log,
          },
          site.ext,
          action,
          pluginArgs(request),
          site.patch
        )
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    getJson: (_ctx, url, options = {}) =>
      deps.net.getJson(url, {
        headers: options.headers,
        timeoutMs: Math.min(Math.max(options.timeoutMs ?? 10000, 1000), 60000),
        ttlMs: 60_000,
      }),

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
