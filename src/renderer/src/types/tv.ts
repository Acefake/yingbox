import type { Genre, ProductionCompany, ProductionCountry, SpokenLanguage, ImageInfo } from './common'
import type { CastMember, CrewMember, VideoInfo } from './movie'

/**
 * 电视剧相关类型定义
 * 
 * 包含电视剧信息、季集信息、搜索结果等电视剧模块专用类型
 */

/**
 * 电视剧信息接口（TMDB API响应）
 */
export interface TVInfoType {
  /** 电视剧ID */
  id: number
  /** 电视剧名称 */
  name: string
  /** 原始名称 */
  original_name: string
  /** 电视剧简介 */
  overview: string
  /** 标语 */
  tagline?: string
  /** 首播日期 */
  first_air_date: string
  /** 最后播出日期 */
  last_air_date?: string
  /** 原始语言 */
  original_language: string
  /** 原产国 */
  origin_country: string[]
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
  /** 类型列表 */
  genres: Genre[]
  /** 类型ID列表 */
  genre_ids?: number[]
  /** 状态 */
  status: string
  /** 电视剧类型 */
  type: string
  /** 是否在播 */
  in_production: boolean
  /** 季数 */
  number_of_seasons: number
  /** 总集数 */
  number_of_episodes: number
  /** 单集时长 */
  episode_run_time: number[]
  /** 创作者 */
  created_by: CreatedBy[]
  /** 制作公司 */
  production_companies: ProductionCompany[]
  /** 制作国家 */
  production_countries: ProductionCountry[]
  /** 语言信息 */
  spoken_languages: SpokenLanguage[]
  /** 播出网络 */
  networks: Network[]
  /** 主页URL */
  homepage?: string
  /** 季信息列表 */
  seasons: SeasonInfo[]
  /** 最后播出的集 */
  last_episode_to_air?: EpisodeInfo
  /** 下一集播出 */
  next_episode_to_air?: EpisodeInfo
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
  /** 外部ID */
  external_ids?: {
    imdb_id?: string
    freebase_mid?: string
    freebase_id?: string
    tvdb_id?: number
    tvrage_id?: number
    facebook_id?: string
    instagram_id?: string
    twitter_id?: string
  }
}

/**
 * 创作者信息接口
 */
export interface CreatedBy {
  /** 创作者ID */
  id: number
  /** 信用ID */
  credit_id: string
  /** 姓名 */
  name: string
  /** 性别（1=女性，2=男性） */
  gender: number
  /** 头像路径 */
  profile_path?: string
}

/**
 * 播出网络接口
 */
export interface Network {
  /** 网络ID */
  id: number
  /** 网络名称 */
  name: string
  /** Logo路径 */
  logo_path?: string
  /** 原产国 */
  origin_country: string
}

/**
 * 季信息接口
 */
export interface SeasonInfo {
  /** 季ID */
  id: number
  /** 季名称 */
  name: string
  /** 季简介 */
  overview: string
  /** 季号 */
  season_number: number
  /** 集数 */
  episode_count: number
  /** 首播日期 */
  air_date?: string
  /** 海报路径 */
  poster_path?: string
  /** 集列表（详细信息时包含） */
  episodes?: EpisodeInfo[]
}

/**
 * 集信息接口
 */
export interface EpisodeInfo {
  /** 集ID */
  id: number
  /** 集名称 */
  name: string
  /** 集简介 */
  overview: string
  /** 集号 */
  episode_number: number
  /** 季号 */
  season_number: number
  /** 播出日期 */
  air_date?: string
  /** 运行时长 */
  runtime?: number
  /** 评分 */
  vote_average: number
  /** 投票数 */
  vote_count: number
  /** 剧照路径 */
  still_path?: string
  /** 制作代码 */
  production_code?: string
  /** 演员信息 */
  guest_stars?: CastMember[]
  /** 工作人员信息 */
  crew?: CrewMember[]
}

/**
 * 电视剧搜索结果接口
 */
export interface TVSearchResult {
  /** 电视剧ID */
  id: number
  /** 电视剧名称 */
  name: string
  /** 原始名称 */
  original_name: string
  /** 电视剧简介 */
  overview: string
  /** 首播日期 */
  first_air_date: string
  /** 原始语言 */
  original_language: string
  /** 原产国 */
  origin_country: string[]
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
  /** 类型ID列表 */
  genre_ids: number[]
}

/**
 * 电视剧搜索响应接口
 */
export interface TVSearchResponse {
  /** 页码 */
  page: number
  /** 搜索结果 */
  results: TVSearchResult[]
  /** 总页数 */
  total_pages: number
  /** 总结果数 */
  total_results: number
}

/**
 * 电视剧状态枚举
 */
export enum TVStatus {
  /** 回归系列 */
  RETURNING_SERIES = 'Returning Series',
  /** 计划中 */
  PLANNED = 'Planned',
  /** 制作中 */
  IN_PRODUCTION = 'In Production',
  /** 已结束 */
  ENDED = 'Ended',
  /** 已取消 */
  CANCELED = 'Canceled',
  /** 试播集 */
  PILOT = 'Pilot'
}

/**
 * 电视剧类型枚举
 */
export enum TVType {
  /** 脚本剧 */
  SCRIPTED = 'Scripted',
  /** 真人秀 */
  REALITY = 'Reality',
  /** 纪录片 */
  DOCUMENTARY = 'Documentary',
  /** 新闻 */
  NEWS = 'News',
  /** 脱口秀 */
  TALK_SHOW = 'Talk Show',
  /** 迷你剧 */
  MINISERIES = 'Miniseries',
  /** 视频 */
  VIDEO = 'Video'
}

/**
 * 电视剧NFO数据接口
 */
export interface TVShowNFOData {
  /** 标题 */
  title: string
  /** 原始标题 */
  originaltitle?: string
  /** 年份 */
  year?: number
  /** 首播日期 */
  premiered?: string
  /** 剧情简介 */
  plot?: string
  /** 标语 */
  tagline?: string
  /** 评分 */
  rating?: number
  /** 投票数 */
  votes?: number
  /** TMDB ID */
  tmdbid?: number
  /** IMDB ID */
  imdbid?: string
  /** TVDB ID */
  tvdbid?: number
  /** 语言 */
  language?: string
  /** 状态 */
  status?: string
  /** 类型列表 */
  genres?: string[]
  /** 制作公司 */
  studios?: string[]
  /** 制作国家 */
  countries?: string[]
  /** 播出网络 */
  networks?: string[]
  /** 演员列表 */
  actors?: Array<{
    name: string
    role: string
    thumb?: string
  }>
  /** 创作者列表 */
  creators?: string[]
  /** 季数 */
  seasons?: number
  /** 总集数 */
  episodes?: number
  /** 单集时长 */
  runtime?: number[]
}

/**
 * 季NFO数据接口
 */
export interface SeasonNFOData {
  /** 季标题 */
  title: string
  /** 季号 */
  seasonnumber: number
  /** 剧情简介 */
  plot?: string
  /** 首播日期 */
  premiered?: string
  /** 年份 */
  year?: number
  /** 集数 */
  episodes?: number
  /** TMDB ID */
  tmdbid?: number
  /** TVDB ID */
  tvdbid?: number
}

/**
 * 集NFO数据接口
 */
export interface EpisodeNFOData {
  /** 集标题 */
  title: string
  /** 季号 */
  season: number
  /** 集号 */
  episode: number
  /** 剧情简介 */
  plot?: string
  /** 播出日期 */
  aired?: string
  /** 年份 */
  year?: number
  /** 运行时长 */
  runtime?: number
  /** 评分 */
  rating?: number
  /** 投票数 */
  votes?: number
  /** TMDB ID */
  tmdbid?: number
  /** TVDB ID */
  tvdbid?: number
  /** IMDB ID */
  imdbid?: string
  /** 导演列表 */
  directors?: string[]
  /** 编剧列表 */
  writers?: string[]
  /** 客串演员 */
  gueststars?: Array<{
    name: string
    role: string
    thumb?: string
  }>
}

/**
 * 电视剧刮削配置接口
 */
export interface TVScrapeConfig {
  /** 是否下载海报 */
  downloadPoster: boolean
  /** 是否下载艺术图 */
  downloadFanart: boolean
  /** 是否生成NFO */
  generateNFO: boolean
  /** 是否下载季海报 */
  downloadSeasonPosters: boolean
  /** 是否下载集剧照 */
  downloadEpisodeStills: boolean
  /** 是否生成季NFO */
  generateSeasonNFO: boolean
  /** 是否生成集NFO */
  generateEpisodeNFO: boolean
  /** 海报质量 */
  posterQuality: 'w185' | 'w342' | 'w500' | 'w780' | 'original'
  /** 艺术图质量 */
  fanartQuality: 'w300' | 'w780' | 'w1280' | 'original'
  /** 剧照质量 */
  stillQuality: 'w185' | 'w300' | 'w500' | 'original'
  /** 是否覆盖现有文件 */
  overwriteExisting: boolean
  /** 语言偏好 */
  language: string
}

/**
 * 电视剧文件解析结果接口
 */
export interface TVFileParseResult {
  /** 电视剧名称 */
  showName: string
  /** 季号 */
  season: number
  /** 集号 */
  episode: number
  /** 年份 */
  year?: number
  /** 分辨率 */
  resolution?: string
  /** 编码格式 */
  codec?: string
  /** 音频格式 */
  audio?: string
  /** 发布组 */
  releaseGroup?: string
  /** 是否为合集 */
  isMultiEpisode: boolean
  /** 集号范围（如果是合集） */
  episodeRange?: number[]
}