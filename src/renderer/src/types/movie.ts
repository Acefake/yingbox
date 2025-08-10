import type { Genre, ProductionCompany, ProductionCountry, SpokenLanguage, ImageInfo } from './common'

/**
 * 电影相关类型定义
 * 
 * 包含电影信息、搜索结果、演员信息等电影模块专用类型
 */

/**
 * 电影信息接口（TMDB API响应）
 */
export interface MovieInfoType {
  /** 电影ID */
  id: number
  /** 电影标题 */
  title: string
  /** 原始标题 */
  original_title: string
  /** 电影简介 */
  overview: string
  /** 标语 */
  tagline?: string
  /** 上映日期 */
  release_date: string
  /** 原始语言 */
  original_language: string
  /** 成人内容标识 */
  adult: boolean
  /** 海报路径 */
  poster_path?: string
  /** 背景图路径 */
  backdrop_path?: string
  /** 评分 */
  vote_average: number
  /** 投票数 */
  vote_count: number
  /** 受欢迎程度 */
  popularity: number
  /** 视频标识 */
  video: boolean
  /** 类型列表 */
  genres: Genre[]
  /** 类型ID列表 */
  genre_ids?: number[]
  /** 运行时长（分钟） */
  runtime?: number
  /** 状态 */
  status?: string
  /** 预算 */
  budget?: number
  /** 票房收入 */
  revenue?: number
  /** IMDB ID */
  imdb_id?: string
  /** 主页URL */
  homepage?: string
  /** 制作公司 */
  production_companies?: ProductionCompany[]
  /** 制作国家 */
  production_countries?: ProductionCountry[]
  /** 语言信息 */
  spoken_languages?: SpokenLanguage[]
  /** 演员信息（如果包含credits） */
  credits?: {
    cast: CastMember[]
    crew: CrewMember[]
  }
  /** 图片信息（如果包含images） */
  images?: {
    backdrops: ImageInfo[]
    posters: ImageInfo[]
    logos: ImageInfo[]
  }
  /** 视频信息（如果包含videos） */
  videos?: {
    results: VideoInfo[]
  }
}

/**
 * 演员信息接口
 */
export interface CastMember {
  /** 演员ID */
  id: number
  /** 演员姓名 */
  name: string
  /** 原始姓名 */
  original_name: string
  /** 角色名 */
  character: string
  /** 性别（1=女性，2=男性） */
  gender: number
  /** 头像路径 */
  profile_path?: string
  /** 演员顺序 */
  order: number
  /** 演员ID（在演员表中） */
  cast_id: number
  /** 信用ID */
  credit_id: string
  /** 成人演员标识 */
  adult: boolean
  /** 知名度 */
  popularity: number
  /** 已知作品部门 */
  known_for_department: string
}

/**
 * 工作人员信息接口
 */
export interface CrewMember {
  /** 工作人员ID */
  id: number
  /** 姓名 */
  name: string
  /** 原始姓名 */
  original_name: string
  /** 职位 */
  job: string
  /** 部门 */
  department: string
  /** 性别（1=女性，2=男性） */
  gender: number
  /** 头像路径 */
  profile_path?: string
  /** 信用ID */
  credit_id: string
  /** 成人标识 */
  adult: boolean
  /** 知名度 */
  popularity: number
  /** 已知作品部门 */
  known_for_department: string
}

/**
 * 视频信息接口
 */
export interface VideoInfo {
  /** 视频ID */
  id: string
  /** ISO语言代码 */
  iso_639_1: string
  /** ISO国家代码 */
  iso_3166_1: string
  /** 视频标题 */
  name: string
  /** 视频密钥 */
  key: string
  /** 视频网站 */
  site: string
  /** 视频大小 */
  size: number
  /** 视频类型 */
  type: string
  /** 是否官方 */
  official: boolean
  /** 发布日期 */
  published_at: string
}

/**
 * 电影搜索结果接口
 */
export interface MovieSearchResult {
  /** 电影ID */
  id: number
  /** 电影标题 */
  title: string
  /** 原始标题 */
  original_title: string
  /** 电影简介 */
  overview: string
  /** 上映日期 */
  release_date: string
  /** 原始语言 */
  original_language: string
  /** 成人内容标识 */
  adult: boolean
  /** 海报路径 */
  poster_path?: string
  /** 背景图路径 */
  backdrop_path?: string
  /** 评分 */
  vote_average: number
  /** 投票数 */
  vote_count: number
  /** 受欢迎程度 */
  popularity: number
  /** 视频标识 */
  video: boolean
  /** 类型ID列表 */
  genre_ids: number[]
}

/**
 * 电影搜索响应接口
 */
export interface MovieSearchResponse {
  /** 页码 */
  page: number
  /** 搜索结果 */
  results: MovieSearchResult[]
  /** 总页数 */
  total_pages: number
  /** 总结果数 */
  total_results: number
}

/**
 * 电影收藏接口
 */
export interface MovieCollection {
  /** 收藏ID */
  id: number
  /** 收藏名称 */
  name: string
  /** 收藏简介 */
  overview: string
  /** 海报路径 */
  poster_path?: string
  /** 背景图路径 */
  backdrop_path?: string
  /** 收藏中的电影 */
  parts: MovieSearchResult[]
}

/**
 * 电影状态枚举
 */
export enum MovieStatus {
  /** 传言 */
  RUMORED = 'Rumored',
  /** 计划中 */
  PLANNED = 'Planned',
  /** 制作中 */
  IN_PRODUCTION = 'In Production',
  /** 后期制作 */
  POST_PRODUCTION = 'Post Production',
  /** 已上映 */
  RELEASED = 'Released',
  /** 已取消 */
  CANCELED = 'Canceled'
}

/**
 * 电影NFO数据接口
 */
export interface MovieNFOData {
  /** 标题 */
  title: string
  /** 原始标题 */
  originaltitle?: string
  /** 年份 */
  year?: number
  /** 上映日期 */
  releasedate?: string
  /** 剧情简介 */
  plot?: string
  /** 标语 */
  tagline?: string
  /** 运行时长 */
  runtime?: number
  /** 评分 */
  rating?: number
  /** 投票数 */
  votes?: number
  /** TMDB ID */
  tmdbid?: number
  /** IMDB ID */
  imdbid?: string
  /** 语言 */
  language?: string
  /** 状态 */
  status?: string
  /** 预算 */
  budget?: number
  /** 票房 */
  revenue?: number
  /** 类型列表 */
  genres?: string[]
  /** 制作公司 */
  studios?: string[]
  /** 制作国家 */
  countries?: string[]
  /** 演员列表 */
  actors?: Array<{
    name: string
    role: string
    thumb?: string
  }>
  /** 导演列表 */
  directors?: string[]
  /** 编剧列表 */
  writers?: string[]
}

/**
 * 电影刮削配置接口
 */
export interface MovieScrapeConfig {
  /** 是否下载海报 */
  downloadPoster: boolean
  /** 是否下载艺术图 */
  downloadFanart: boolean
  /** 是否生成NFO */
  generateNFO: boolean
  /** 海报质量 */
  posterQuality: 'w185' | 'w342' | 'w500' | 'w780' | 'original'
  /** 艺术图质量 */
  fanartQuality: 'w300' | 'w780' | 'w1280' | 'original'
  /** 是否覆盖现有文件 */
  overwriteExisting: boolean
  /** 语言偏好 */
  language: string
}