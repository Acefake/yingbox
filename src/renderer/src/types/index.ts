/**
 * 类型定义统一导出文件
 * 
 * 提供项目中所有类型定义的统一入口
 * 支持按模块导入或全量导入
 */

// 通用类型
export type {
  FileItem,
  ProcessedItem,
  Props,
  ApiResponse,
  PaginationParams,
  PaginatedResponse,
  SearchParams,
  ImageInfo,
  Genre,
  ProductionCompany,
  ProductionCountry,
  SpokenLanguage,
  ExternalIds,
  AppConfig,
  AppError
} from './common'

export { ErrorType } from './common'

// 电影相关类型
export type {
  MovieInfoType,
  CastMember,
  CrewMember,
  VideoInfo,
  MovieSearchResult,
  MovieSearchResponse,
  MovieCollection,
  MovieNFOData,
  MovieScrapeConfig
} from './movie'

export { MovieStatus } from './movie'

// 电视剧相关类型
export type {
  TVInfoType,
  CreatedBy,
  Network,
  SeasonInfo,
  EpisodeInfo,
  TVSearchResult,
  TVSearchResponse,
  TVShowNFOData,
  SeasonNFOData,
  EpisodeNFOData,
  TVScrapeConfig,
  TVFileParseResult
} from './tv'

export { TVStatus, TVType } from './tv'

// API相关类型
export type {
  TMDBConfig,
  TMDBResponse,
  TMDBConfigurationResponse,
  MovieSearchParams,
  TVSearchParams,
  MovieDetailsParams,
  TVDetailsParams,
  SeasonDetailsParams,
  EpisodeDetailsParams,
  ImagesParams,
  VideosParams,
  CreditsParams,
  ExternalIdsParams,
  LocalApiResponse,
  FileOperationParams,
  DirectoryScanParams,
  ScrapeTaskParams,
  ScrapeTaskResponse,
  BatchScrapeParams,
  BatchScrapeResponse,
  CacheParams,
  CacheResponse,
  SystemInfoResponse,
  ApiErrorResponse,
  ApiRequestConfig
} from './api'

// 队列相关类型
export type {
  ScrapeQueueItem,
  ScrapeConfig,
  ScrapeResult,
  DownloadedFile,
  QueueStats,
  QueueConfig,
  QueueEvent,
  QueueFilter,
  QueueSortOptions,
  BatchOperationParams,
  BatchOperationResult,
  QueueExportOptions,
  QueueImportOptions
} from './queue'

export {
  QueueItemStatus,
  QueuePriority,
  MediaType,
  QueueEventType,
  BatchOperationType
} from './queue'

// 模块化导出（按功能分组）
export * as CommonTypes from './common'
export * as MovieTypes from './movie'
export * as TVTypes from './tv'
export * as ApiTypes from './api'
export * as QueueTypes from './queue'