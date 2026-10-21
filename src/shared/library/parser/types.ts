/**
 * 文件名解析结果的数据形状。
 */

/** 外部数据库 ID，统一用字符串；imdb 保留 tt 前缀。 */
export interface ExternalIds {
  tmdb?: string
  imdb?: string
  tvdb?: string
}

/** 解析出的媒体类型：正片电影、剧集单集、附加内容（样片/预告/花絮等）。 */
export type ParsedMediaType = 'movie' | 'episode' | 'extra'

/** 三种类型共有的字段。 */
interface ParsedBase {
  /** 主标题；中英双标题时为中日韩文部分。 */
  title: string
  /** 副标题；中英双标题时为拉丁文部分。 */
  altTitle?: string
  /** 发行 / 首播年份。 */
  year?: number
  /** 文件名或所属文件夹里写明的外部 ID。 */
  ids?: ExternalIds
}

/** 电影正片。 */
export interface ParsedMovie extends ParsedBase {
  type: 'movie'
  /** 分段序号（CD1 / part2 / Disc 1）。 */
  part?: number
  /** 番号库里从文件名解析出的番号（此时 title 也是番号）。 */
  code?: string
}

/** 剧集单集（可能一个文件含多集）。 */
export interface ParsedEpisode extends ParsedBase {
  type: 'episode'
  /** 季号；0 表示特别篇；未写明时缺省。 */
  season?: number
  /** 集号列表，升序；按日期编号的节目为空数组。 */
  episodes: number[]
  /** 为 true 表示集号是动画式的绝对集数（没有季信息）。 */
  absolute?: boolean
  /** 日播节目的播出日期，YYYY-MM-DD。 */
  airDate?: string
}

/** 附加内容；标题与年份指向它所属的作品。 */
export interface ParsedExtra extends ParsedBase {
  type: 'extra'
}

/** 一个媒体文件路径的解析结果。 */
export type ParsedMedia = ParsedMovie | ParsedEpisode | ParsedExtra
