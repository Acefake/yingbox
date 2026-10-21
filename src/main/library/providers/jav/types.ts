/**
 * 番号刮削的类型：站点 id、单站点结果、站点接口与站点拿网页用的上下文。
 */
import type { JavSiteId } from '../../../../shared/library/ipc'
import type { JavCode, JavCodeKind } from './number'

export type { JavSiteId } from '../../../../shared/library/ipc'

/** 演员：名字 + 头像（站点有就带）。 */
export interface JavActor {
  name: string
  photo?: string
}

/**
 * 一个站点刮到的结果。字段都可缺省：聚合时按站点优先级逐字段取第一个非空值。
 * 图片都是绝对 URL。
 */
export interface JavRecord {
  site: JavSiteId
  /** 站点页面上写的番号。 */
  code: string
  /** 详情页地址。 */
  url: string
  title?: string
  /** YYYY-MM-DD。 */
  releaseDate?: string
  runtimeMinutes?: number
  director?: string
  /** 制作商（maker / studio）。 */
  studio?: string
  /** 发行商（label）。 */
  label?: string
  series?: string
  tags: string[]
  actors: JavActor[]
  overview?: string
  /** 横版封面（DVD 封套全图）。 */
  cover?: string
  /** 竖版海报。 */
  poster?: string
  /** 剧照。 */
  stills: string[]
}

/** 站点取网页的选项。 */
export interface PageOptions {
  /** 附加 Cookie（如 javbus 的年龄确认）。 */
  cookie?: string
  /** 附加请求头（如 Accept-Language、POST 的 Content-Type）。 */
  headers?: Record<string, string>
  /** 缺省 GET；站内搜索表单（jav321）、JSON 接口（avsox）用 POST。 */
  method?: 'GET' | 'POST'
  /** POST 请求体。 */
  body?: string
}

/** 站点拿网页用的上下文：限速、重试、熔断、防护页识别都在这一层。 */
export interface SiteContext {
  /** 取页面；404 返回 null，被拦截 / 网络失败抛错。 */
  page(url: string, options?: PageOptions): Promise<string | null>
  signal?: AbortSignal
}

/** 一个番号站点。 */
export interface JavSite {
  readonly id: JavSiteId
  /** 能查这一类番号吗。 */
  supports(kind: JavCodeKind): boolean
  /** 查一个番号；站点没有这部片返回 null。 */
  fetch(code: JavCode, ctx: SiteContext): Promise<JavRecord | null>
}
