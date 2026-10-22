import {
  ContractError,
  call,
  defineDomain,
  oneOf,
  optRecord,
  optStr,
  record,
  str,
} from './define'
import type { HostTrip } from '../net/host-breaker'

export type { HostScope, HostTrip, TripReason } from '../net/host-breaker'

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
  /** 本次调用碰到的熔断（站点被拦截 / 连不上 / 插件下载失败）；渲染层据此把源标成不可用 */
  unavailable?: HostTrip
}

/**
 * online.tmdb 允许的 TMDB v3 路径：搜索（电影 / 剧集 / 混合）与详情、演职员、图片。
 * 令牌在引擎里加，渲染层只给路径与查询参数，所以路径要收窄，不能当通用代理用。
 */
export const TMDB_PATH_RE =
  /^\/(?:search\/(?:movie|tv|multi)|(?:movie|tv)\/\d{1,9}(?:\/(?:credits|images))?)$/

/** online.getJson 的选项。 */
export interface GetJsonOptions {
  headers?: Record<string, string>
  timeoutMs?: number
}

/** 在线域：CMS / 豆瓣（含预告片）/ TMDB 请求与 CatSpider 插件，全部在引擎经 net 出网。 */
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
  /** 解除插件源的主机熔断（引擎与浏览器代抓两边）；不给主机则全部解除 */
  resetBlocks: call<[host?: string], void>(a => [optStr(a[0], 'host')]),
  /** GET 一个 JSON 接口（CMS、豆瓣、TMDB、源清单）；失败 reject */
  getJson: call<[url: string, options?: GetJsonOptions], unknown>(a => [
    str(a[0], 'url'),
    optRecord<GetJsonOptions>(a[1], 'options'),
  ]),
  /** 请求 TMDB v3 接口（引擎加令牌）；未配置令牌返回 null，请求失败 reject */
  tmdb: call<
    [path: string, query?: Record<string, string | number>],
    unknown | null
  >(a => {
    const path = str(a[0], 'path')
    if (!TMDB_PATH_RE.test(path))
      throw new ContractError(`不允许的 TMDB 路径：${path}`)
    return [path, optRecord<Record<string, string | number>>(a[1], 'query')]
  }),
  /**
   * 豆瓣预告片 mp4（豆瓣卡悬停预览）：subjectId 是 movie.douban.com/subject/<id>/ 里的数字，
   * kind 缺省 movie。无预告 / 请求失败 / 熔断中返回 null。见 engine/online/douban-trailer.ts
   */
  doubanTrailer: call<
    [subjectId: string, kind?: 'movie' | 'tv'],
    string | null
  >(a => {
    const id = str(a[0], 'subjectId')
    if (!/^\d{1,12}$/.test(id))
      throw new ContractError(`豆瓣条目 ID 不合法：${id}`)
    return [
      id,
      a[1] === undefined
        ? 'movie'
        : oneOf(a[1], 'kind', ['movie', 'tv'] as const),
    ]
  }),
  /** 播放页 → 媒体直链：跟随跳转后从 HTML 中找 m3u8；找不到原样返回 */
  resolvePage: call<[url: string], string>(a => [str(a[0], 'url')]),
})
