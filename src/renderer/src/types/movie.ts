/**
 * 电影相关类型定义
 */

/**
 * 电影信息接口（NFO 解析后的结构）
 */
export interface MovieInfoType {
  /** 电影标题 */
  title?: string
  /** 原始标题 */
  originaltitle?: string
  /** 年份 */
  year?: string
  /** 剧情简介 */
  plot?: string
  /** 类型列表 */
  genre?: string[]
  /** 导演 */
  director?: string
  /** 演员列表 */
  actor?: string[]
  /** 评分 */
  rating?: string
  /** 时长 */
  runtime?: string
  /** 国家 */
  country?: string
  /** 制片公司 */
  studio?: string
  /** 首映日期 */
  premiered?: string
}

/**
 * 刮削任务接口
 */
export interface ScrapeTask {
  /** 待处理的项目 */
  item: import('@/types/file').ProcessedItem
  /** 匹配的电影信息 */
  movie: import('@tdanks2000/tmdb-wrapper').Movie
}

/**
 * 刮削结果接口
 */
export interface ScrapeResult {
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** NFO 文件路径 */
  nfoPath?: string
  /** 海报路径 */
  posterPath?: string
  /** 背景图路径 */
  fanartPath?: string
}

/**
 * TMDB 电影详情扩展接口
 */
export interface TMDBMovieDetail {
  /** 电影 ID */
  id: number
  /** 标题 */
  title: string
  /** 原始标题 */
  original_title: string
  /** 剧情简介 */
  overview: string
  /** 发布日期 */
  release_date: string
  /** 海报路径 */
  poster_path: string | null
  /** 背景图路径 */
  backdrop_path: string | null
  /** 评分 */
  vote_average: number
  /** 评分人数 */
  vote_count: number
  /** 类型 ID 列表 */
  genre_ids: number[]
  /** 是否成人内容 */
  adult: boolean
  /** 原始语言 */
  original_language: string
  /** 热度 */
  popularity: number
  /** 是否有视频 */
  video: boolean
  /** 导演列表 */
  directors?: Director[]
  /** 演员列表 */
  cast?: Cast[]
}

/**
 * 导演接口
 */
export interface Director {
  /** 导演 ID */
  id: number
  /** 导演姓名 */
  name: string
  /** 头像路径 */
  profile_path?: string
  /** TMDB ID */
  tmdbid?: number
}

/**
 * 演员接口
 */
export interface Cast {
  /** 演员 ID */
  id: number
  /** 演员姓名 */
  name: string
  /** 扮演角色 */
  character?: string
  /** 头像路径 */
  profile_path?: string
  /** TMDB ID */
  tmdbid?: number
  /** 顺序 */
  order?: number
}
