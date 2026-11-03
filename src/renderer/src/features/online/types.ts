/**
 * 在线域共用的数据形状：CMS / CatSpider 搜索条目、播放线路分组、站点配置。
 */
import type { CmsItem } from '../../../../shared/online/types'

export type { PluginExt, RawVod } from '../../../../shared/online/vod-data'

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
  doubanRating?: string
  backdrop?: string
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
export type { TmdbDetail } from '../../../../shared/tmdb/types'

/** TMDB 演职员里的一位演员 */
export interface TmdbCastMember {
  id: number
  name: string
  character?: string
  profile_path?: string | null
}

/** 详情页的一张剧照（TMDB 或豆瓣），缩略图与原图都是完整地址 */
export type { DetailImage } from '../../../../shared/contract/online'

/** CMS / CatSpider 条目、线路、站点（形状在 shared/online/types.ts，服务端选源共用） */
export type {
  CmsSource,
  CmsItem,
  Episode,
  EpisodeGroup,
  ApiSite,
  CatSpiderSite,
} from '../../../../shared/online/types'

/** 豆瓣卡片（在线首页；也原样存进收藏 media_favorites） */
export type { DoubanItem } from '../../../../shared/douban/item'
