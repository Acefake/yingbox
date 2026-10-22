/**
 * 在线域共用的数据形状：CMS / CatSpider 搜索条目、播放线路分组、站点配置。
 */
import type { PluginExt } from '@/utils/vod-data'

export type { PluginExt, RawVod } from '@/utils/vod-data'

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
  _ext?: PluginExt
}

/** 一集：名称、地址，插件线路还带插件参数。 */
export interface Episode {
  name: string
  url: string
  ext?: PluginExt
}

/** 一条播放线路：同一来源下的一组剧集。 */
export interface EpisodeGroup {
  label: string
  episodes: Episode[]
  hasDirect: boolean
  _source?: 'cms' | 'catspider'
  _siteName?: string
}

/**
 * 详情页打开的条目：来自搜索 / 浏览（CmsItem）、最近播放、或豆瓣卡片（_source 为 douban，
 * 带 overview / searchTitle）。可能是从别的窗口传过来的，字段都按可能缺失处理。
 */
export interface OnlineDetailItem extends Partial<Omit<CmsItem, '_source'>> {
  _source?: 'cms' | 'catspider' | 'douban'
  vod_desc?: string
  /** 豆瓣卡片带的简介 */
  overview?: string
  /** 豆瓣卡片用来搜源的片名（可能和展示名不同） */
  searchTitle?: string
  /** 豆瓣条目地址 movie.douban.com/subject/<id>/（取豆瓣剧照兜底） */
  doubanUrl?: string
  /** 豆瓣条目类型（豆瓣卡来自「电影」还是「电视剧」分类） */
  doubanKind?: 'movie' | 'tv'
}

/** 在线播放历史（localStorage online_play_history）的一条：条目字段平铺 + item 原样 + 播放位置 */
export interface OnlinePlayRecord {
  url?: string
  epName?: string
  progress?: number
  duration?: number
  timestamp?: number
  groupLabel?: string
  item?: OnlineDetailItem
  vod_id?: string | number
  vod_name?: string
  vod_pic?: string
  [key: string]: unknown
}

/** TMDB 影片 / 剧集详情：只声明详情页读的字段 */
export interface TmdbDetail {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number
  release_date?: string
  first_air_date?: string
  runtime?: number
  imdb_id?: string | null
  genres?: { id: number; name: string }[]
  production_countries?: { name: string }[]
}

/** TMDB 演职员里的一位演员 */
export interface TmdbCastMember {
  id: number
  name: string
  character?: string
  profile_path?: string | null
}

/** 详情页的一张剧照（TMDB 或豆瓣），缩略图与原图都是完整地址 */
export type { DetailImage } from '../../../../shared/contract/online'

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

/** 豆瓣卡片（在线首页；也原样存进收藏 media_favorites） */
export interface DoubanItem {
  title: string
  /** 用来搜源的片名：TMDB 找到条目时换成 TMDB 的中文名 */
  searchTitle: string
  original_title: string
  /** 显示用封面：TMDB 海报，找不到退回豆瓣封面；补全前为空 */
  cover: string
  /** 豆瓣封面 */
  coverSrc: string
  /** 评分文字，无评分为「暂无」 */
  rate: string
  /** movie.douban.com/subject/<id>/（去重键、取预告片用） */
  url: string
  year: string
  /** 「电影」/「剧集」，TMDB 补全后才有 */
  type: string
  overview: string
  /** 来自「电影」还是「电视剧」分类（取预告片时用；旧收藏里没有，按电影取） */
  kind?: 'movie' | 'tv'
}
