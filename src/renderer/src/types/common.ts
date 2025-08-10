/**
 * 通用类型定义
 * 
 * 包含项目中使用的基础接口和类型定义
 * 如文件项、处理项、组件属性等通用类型
 */

/**
 * 文件项接口
 * 表示文件系统中的一个文件或目录
 */
export interface FileItem {
  /** 文件名 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 文件大小（字节） */
  size: number
  /** 修改时间 */
  modifiedTime: string
}

/**
 * 处理后的文件项接口
 * 在FileItem基础上添加了媒体相关的属性
 */
export interface ProcessedItem {
  /** 文件名 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 是否为视频文件 */
  isVideo: boolean
  /** 文件大小（字节） */
  size: number
  /** 修改时间 */
  modifiedTime: string
  /** 是否有NFO文件 */
  hasNfo: boolean
  /** 是否有海报文件 */
  hasPoster: boolean
  /** 是否有艺术图文件 */
  hasFanart: boolean
  /** 子文件列表（如果是目录） */
  children: FileItem[]
}

/**
 * 组件通用属性接口
 */
export interface Props {
  /** 组件ID */
  id?: string
  /** CSS类名 */
  className?: string
  /** 内联样式 */
  style?: Record<string, any>
  /** 是否禁用 */
  disabled?: boolean
  /** 是否加载中 */
  loading?: boolean
}

/**
 * API响应基础接口
 */
export interface ApiResponse<T = any> {
  /** 是否成功 */
  success: boolean
  /** 响应数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /** 错误代码 */
  code?: number
  /** 响应消息 */
  message?: string
}

/**
 * 分页参数接口
 */
export interface PaginationParams {
  /** 页码（从1开始） */
  page: number
  /** 每页数量 */
  pageSize: number
  /** 总数 */
  total?: number
}

/**
 * 分页响应接口
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  /** 分页信息 */
  pagination: PaginationParams
}

/**
 * 搜索参数接口
 */
export interface SearchParams {
  /** 搜索关键词 */
  query: string
  /** 年份 */
  year?: number
  /** 语言 */
  language?: string
  /** 页码 */
  page?: number
}

/**
 * 图片信息接口
 */
export interface ImageInfo {
  /** 图片路径 */
  file_path: string
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
  /** 宽高比 */
  aspect_ratio: number
  /** 投票平均分 */
  vote_average: number
  /** 投票数 */
  vote_count: number
  /** ISO语言代码 */
  iso_639_1?: string
}

/**
 * 类型信息接口
 */
export interface Genre {
  /** 类型ID */
  id: number
  /** 类型名称 */
  name: string
}

/**
 * 制作公司接口
 */
export interface ProductionCompany {
  /** 公司ID */
  id: number
  /** 公司名称 */
  name: string
  /** 公司Logo路径 */
  logo_path?: string
  /** 原产国 */
  origin_country: string
}

/**
 * 制作国家接口
 */
export interface ProductionCountry {
  /** ISO国家代码 */
  iso_3166_1: string
  /** 国家名称 */
  name: string
}

/**
 * 语言信息接口
 */
export interface SpokenLanguage {
  /** ISO语言代码 */
  iso_639_1: string
  /** 语言名称 */
  name: string
  /** 英文名称 */
  english_name: string
}

/**
 * 外部ID接口
 */
export interface ExternalIds {
  /** IMDB ID */
  imdb_id?: string
  /** Facebook ID */
  facebook_id?: string
  /** Instagram ID */
  instagram_id?: string
  /** Twitter ID */
  twitter_id?: string
  /** Wikidata ID */
  wikidata_id?: string
}

/**
 * 应用配置接口
 */
export interface AppConfig {
  /** TMDB API密钥 */
  tmdbApiKey?: string
  /** 默认语言 */
  defaultLanguage: string
  /** 图片质量 */
  imageQuality: 'low' | 'medium' | 'high'
  /** 自动刮削 */
  autoScrape: boolean
  /** 缓存大小限制（MB） */
  cacheLimit: number
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** API错误 */
  API_ERROR = 'API_ERROR',
  /** 文件系统错误 */
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  /** 解析错误 */
  PARSE_ERROR = 'PARSE_ERROR',
  /** 验证错误 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** 未知错误 */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * 应用错误接口
 */
export interface AppError {
  /** 错误类型 */
  type: ErrorType
  /** 错误消息 */
  message: string
  /** 错误详情 */
  details?: any
  /** 错误时间戳 */
  timestamp: number
  /** 错误堆栈 */
  stack?: string
}