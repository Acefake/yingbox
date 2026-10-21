/**
 * 在线域共用的数据形状：CMS / CatSpider 搜索条目、播放线路分组、站点配置。
 */

/** 聚合后的一个 CMS 来源（同名条目的其它站点）。 */
export interface CmsSource {
  source_name: string
  api_url: string
  vod_id: number | string
}

/** 搜索 / 浏览得到的一个影片条目（CMS 与 CatSpider 统一成这一个形状）。 */
export interface CmsItem {
  vod_id: number | string
  vod_name: string
  type_name: string
  vod_year: string
  vod_remarks: string
  vod_pic: string
  vod_play_url?: string
  vod_play_from?: string
  vod_content?: string
  source_name?: string
  api_url?: string
  sources?: CmsSource[]
  _source?: 'cms' | 'catspider'
  _siteName?: string
  _ext?: Record<string, any>
}

/** 一条播放线路：同一来源下的一组剧集。 */
export interface EpisodeGroup {
  label: string
  episodes: { name: string; url: string; ext?: Record<string, any> }[]
  hasDirect: boolean
  _source?: 'cms' | 'catspider'
  _siteName?: string
}

/** 苹果 CMS 站点。 */
export interface ApiSite {
  name: string
  api: string
}

/** CatSpider 插件站点。 */
export interface CatSpiderSite {
  name: string
  type: number
  api: string
  ext: string
}
