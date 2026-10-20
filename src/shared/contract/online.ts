import { call, defineDomain, oneOf, optRecord, record, str } from './define'

/** CatSpider（XPTV）插件站点。 */
export interface CatSpiderSite {
  name: string
  type: 3
  api: string
  /** 插件源码地址 */
  ext: string
  /** 上游插件过期时的源码替换表 */
  patch?: Record<string, string>
}

/** 插件动作。 */
export type CatSpiderAction =
  | 'getConfig'
  | 'search'
  | 'getCards'
  | 'getTracks'
  | 'getPlayinfo'

const VOD_ACTIONS = [
  'getConfig',
  'search',
  'getCards',
  'getTracks',
  'getPlayinfo',
  'parse',
] as const

/** online.vod 的请求：action + 站点名 + 透传给插件的字段。 */
export interface VodRequest {
  action: CatSpiderAction | 'parse'
  siteName: string
  [field: string]: unknown
}

/** online.vod 的结果：插件返回值在 data 里。 */
export interface VodResponse {
  success: boolean
  data?: unknown
  error?: string
}

/** online.getJson 的选项。 */
export interface GetJsonOptions {
  headers?: Record<string, string>
  timeoutMs?: number
}

/** 在线域：CMS / 豆瓣 / TMDB 请求与 CatSpider 插件，全部在引擎经 net 出网。 */
export const online = defineDomain('online', {
  /** 内置 CatSpider 站点表 */
  sites: call<CatSpiderSite[]>(),
  /** 调用 CatSpider 插件动作（取代原 Go /api/vod/parse） */
  vod: call<[request: VodRequest], VodResponse>(a => {
    const request = record<VodRequest>(a[0], 'request')
    oneOf(request.action, 'request.action', VOD_ACTIONS)
    str(request.siteName, 'request.siteName')
    return [request]
  }),
  /** GET 一个 JSON 接口（CMS、豆瓣、TMDB、源清单）；失败 reject */
  getJson: call<[url: string, options?: GetJsonOptions], unknown>(a => [
    str(a[0], 'url'),
    optRecord<GetJsonOptions>(a[1], 'options'),
  ]),
  /** 播放页 → 媒体直链：跟随跳转后从 HTML 中找 m3u8；找不到原样返回 */
  resolvePage: call<[url: string], string>(a => [str(a[0], 'url')]),
})
