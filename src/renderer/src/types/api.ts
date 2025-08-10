import type { ApiResponse, PaginatedResponse, SearchParams } from './common'
import type { MovieInfoType, MovieSearchResponse } from './movie'
import type { TVInfoType, TVSearchResponse } from './tv'

/**
 * API相关类型定义
 * 
 * 包含TMDB API、本地API等各种API接口的请求和响应类型
 */

/**
 * TMDB API配置接口
 */
export interface TMDBConfig {
  /** API密钥 */
  apiKey: string
  /** 基础URL */
  baseUrl: string
  /** 图片基础URL */
  imageBaseUrl: string
  /** 默认语言 */
  language: string
  /** 请求超时时间（毫秒） */
  timeout: number
}

/**
 * TMDB API响应基础接口
 */
export interface TMDBResponse<T = any> {
  /** 响应数据 */
  data?: T
  /** 状态码 */
  status_code?: number
  /** 状态消息 */
  status_message?: string
  /** 是否成功 */
  success?: boolean
}

/**
 * TMDB配置响应接口
 */
export interface TMDBConfigurationResponse {
  /** 图片配置 */
  images: {
    /** 基础URL */
    base_url: string
    /** 安全基础URL */
    secure_base_url: string
    /** 背景图尺寸 */
    backdrop_sizes: string[]
    /** Logo尺寸 */
    logo_sizes: string[]
    /** 海报尺寸 */
    poster_sizes: string[]
    /** 头像尺寸 */
    profile_sizes: string[]
    /** 剧照尺寸 */
    still_sizes: string[]
  }
  /** 变更密钥 */
  change_keys: string[]
}

/**
 * 电影搜索API参数接口
 */
export interface MovieSearchParams extends SearchParams {
  /** 是否包含成人内容 */
  include_adult?: boolean
  /** 地区 */
  region?: string
  /** 主要上映年份 */
  primary_release_year?: number
}

/**
 * 电视剧搜索API参数接口
 */
export interface TVSearchParams extends SearchParams {
  /** 是否包含成人内容 */
  include_adult?: boolean
  /** 首播年份 */
  first_air_date_year?: number
}

/**
 * 电影详情API参数接口
 */
export interface MovieDetailsParams {
  /** 电影ID */
  movie_id: number
  /** 语言 */
  language?: string
  /** 附加信息 */
  append_to_response?: string
}

/**
 * 电视剧详情API参数接口
 */
export interface TVDetailsParams {
  /** 电视剧ID */
  tv_id: number
  /** 语言 */
  language?: string
  /** 附加信息 */
  append_to_response?: string
}

/**
 * 季详情API参数接口
 */
export interface SeasonDetailsParams {
  /** 电视剧ID */
  tv_id: number
  /** 季号 */
  season_number: number
  /** 语言 */
  language?: string
  /** 附加信息 */
  append_to_response?: string
}

/**
 * 集详情API参数接口
 */
export interface EpisodeDetailsParams {
  /** 电视剧ID */
  tv_id: number
  /** 季号 */
  season_number: number
  /** 集号 */
  episode_number: number
  /** 语言 */
  language?: string
  /** 附加信息 */
  append_to_response?: string
}

/**
 * 图片API参数接口
 */
export interface ImagesParams {
  /** 媒体ID */
  id: number
  /** 媒体类型 */
  media_type: 'movie' | 'tv'
  /** 语言 */
  language?: string
  /** 包含图片语言 */
  include_image_language?: string
}

/**
 * 视频API参数接口
 */
export interface VideosParams {
  /** 媒体ID */
  id: number
  /** 媒体类型 */
  media_type: 'movie' | 'tv'
  /** 语言 */
  language?: string
}

/**
 * 演员信息API参数接口
 */
export interface CreditsParams {
  /** 媒体ID */
  id: number
  /** 媒体类型 */
  media_type: 'movie' | 'tv'
  /** 语言 */
  language?: string
}

/**
 * 外部ID API参数接口
 */
export interface ExternalIdsParams {
  /** 媒体ID */
  id: number
  /** 媒体类型 */
  media_type: 'movie' | 'tv'
}

/**
 * 本地API响应接口
 */
export interface LocalApiResponse<T = any> extends ApiResponse<T> {
  /** 请求ID */
  requestId?: string
  /** 响应时间戳 */
  timestamp: number
}

/**
 * 文件操作API参数接口
 */
export interface FileOperationParams {
  /** 文件路径 */
  filePath: string
  /** 操作类型 */
  operation: 'read' | 'write' | 'delete' | 'move' | 'copy'
  /** 目标路径（移动/复制时使用） */
  targetPath?: string
  /** 文件内容（写入时使用） */
  content?: string
}

/**
 * 目录扫描API参数接口
 */
export interface DirectoryScanParams {
  /** 目录路径 */
  directoryPath: string
  /** 是否递归扫描 */
  recursive?: boolean
  /** 文件过滤器 */
  fileFilter?: string[]
  /** 是否包含隐藏文件 */
  includeHidden?: boolean
}

/**
 * 刮削任务API参数接口
 */
export interface ScrapeTaskParams {
  /** 文件路径 */
  filePath: string
  /** 媒体类型 */
  mediaType: 'movie' | 'tv'
  /** 刮削配置 */
  config: {
    /** 是否下载海报 */
    downloadPoster: boolean
    /** 是否下载艺术图 */
    downloadFanart: boolean
    /** 是否生成NFO */
    generateNFO: boolean
    /** 是否覆盖现有文件 */
    overwriteExisting: boolean
    /** 语言偏好 */
    language: string
  }
  /** 手动匹配的媒体ID */
  manualMatchId?: number
}

/**
 * 刮削任务响应接口
 */
export interface ScrapeTaskResponse {
  /** 任务ID */
  taskId: string
  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed'
  /** 进度百分比 */
  progress: number
  /** 结果信息 */
  result?: {
    /** 是否成功 */
    success: boolean
    /** 下载的文件列表 */
    downloadedFiles: string[]
    /** 错误信息 */
    error?: string
  }
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/**
 * 批量刮削API参数接口
 */
export interface BatchScrapeParams {
  /** 文件路径列表 */
  filePaths: string[]
  /** 媒体类型 */
  mediaType: 'movie' | 'tv'
  /** 刮削配置 */
  config: {
    /** 是否下载海报 */
    downloadPoster: boolean
    /** 是否下载艺术图 */
    downloadFanart: boolean
    /** 是否生成NFO */
    generateNFO: boolean
    /** 是否覆盖现有文件 */
    overwriteExisting: boolean
    /** 语言偏好 */
    language: string
    /** 并发数量 */
    concurrency: number
  }
}

/**
 * 批量刮削响应接口
 */
export interface BatchScrapeResponse {
  /** 批次ID */
  batchId: string
  /** 总任务数 */
  totalTasks: number
  /** 已完成任务数 */
  completedTasks: number
  /** 失败任务数 */
  failedTasks: number
  /** 整体进度百分比 */
  progress: number
  /** 批次状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** 任务列表 */
  tasks: ScrapeTaskResponse[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/**
 * 缓存API参数接口
 */
export interface CacheParams {
  /** 缓存键 */
  key: string
  /** 缓存值 */
  value?: any
  /** 过期时间（秒） */
  ttl?: number
}

/**
 * 缓存响应接口
 */
export interface CacheResponse<T = any> {
  /** 缓存键 */
  key: string
  /** 缓存值 */
  value?: T
  /** 是否存在 */
  exists: boolean
  /** 过期时间 */
  expiresAt?: string
}

/**
 * 系统信息响应接口
 */
export interface SystemInfoResponse {
  /** 应用版本 */
  appVersion: string
  /** 平台信息 */
  platform: string
  /** 架构信息 */
  arch: string
  /** 内存使用情况 */
  memory: {
    /** 已使用内存（MB） */
    used: number
    /** 总内存（MB） */
    total: number
  }
  /** 磁盘使用情况 */
  disk: {
    /** 已使用空间（GB） */
    used: number
    /** 总空间（GB） */
    total: number
  }
  /** 缓存统计 */
  cache: {
    /** 缓存项数量 */
    itemCount: number
    /** 缓存大小（MB） */
    size: number
  }
}

/**
 * API错误响应接口
 */
export interface ApiErrorResponse {
  /** 错误代码 */
  code: string
  /** 错误消息 */
  message: string
  /** 错误详情 */
  details?: any
  /** 错误时间戳 */
  timestamp: number
  /** 请求ID */
  requestId?: string
}

/**
 * API请求配置接口
 */
export interface ApiRequestConfig {
  /** 请求URL */
  url: string
  /** 请求方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** 请求头 */
  headers?: Record<string, string>
  /** 请求参数 */
  params?: Record<string, any>
  /** 请求体 */
  data?: any
  /** 超时时间（毫秒） */
  timeout?: number
  /** 是否启用缓存 */
  cache?: boolean
  /** 缓存时间（秒） */
  cacheTTL?: number
}