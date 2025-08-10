/**
 * 队列相关类型定义
 * 
 * 包含刮削队列、任务队列等队列管理相关的类型定义
 */

/**
 * 队列项状态枚举
 */
export enum QueueItemStatus {
  /** 等待中 */
  PENDING = 'pending',
  /** 处理中 */
  PROCESSING = 'processing',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 失败 */
  FAILED = 'failed',
  /** 已跳过 */
  SKIPPED = 'skipped',
  /** 已取消 */
  CANCELLED = 'cancelled'
}

/**
 * 队列优先级枚举
 */
export enum QueuePriority {
  /** 低优先级 */
  LOW = 1,
  /** 普通优先级 */
  NORMAL = 2,
  /** 高优先级 */
  HIGH = 3,
  /** 紧急优先级 */
  URGENT = 4
}

/**
 * 媒体类型枚举
 */
export enum MediaType {
  /** 电影 */
  MOVIE = 'movie',
  /** 电视剧 */
  TV = 'tv'
}

/**
 * 刮削队列项接口
 */
export interface ScrapeQueueItem {
  /** 唯一ID */
  id: string
  /** 文件路径 */
  filePath: string
  /** 文件名 */
  fileName: string
  /** 媒体类型 */
  mediaType: MediaType
  /** 状态 */
  status: QueueItemStatus
  /** 优先级 */
  priority: QueuePriority
  /** 进度百分比 */
  progress: number
  /** 错误信息 */
  error?: string
  /** 结果信息 */
  result?: ScrapeResult
  /** 创建时间 */
  createdAt: string
  /** 开始处理时间 */
  startedAt?: string
  /** 完成时间 */
  completedAt?: string
  /** 重试次数 */
  retryCount: number
  /** 最大重试次数 */
  maxRetries: number
  /** 手动匹配的媒体ID */
  manualMatchId?: number
  /** 刮削配置 */
  config: ScrapeConfig
}

/**
 * 刮削配置接口
 */
export interface ScrapeConfig {
  /** 是否下载海报 */
  downloadPoster: boolean
  /** 是否下载艺术图 */
  downloadFanart: boolean
  /** 是否生成NFO文件 */
  generateNFO: boolean
  /** 是否下载季海报（仅TV） */
  downloadSeasonPosters?: boolean
  /** 是否下载集剧照（仅TV） */
  downloadEpisodeStills?: boolean
  /** 是否生成季NFO（仅TV） */
  generateSeasonNFO?: boolean
  /** 是否生成集NFO（仅TV） */
  generateEpisodeNFO?: boolean
  /** 海报质量 */
  posterQuality: 'w185' | 'w342' | 'w500' | 'w780' | 'original'
  /** 艺术图质量 */
  fanartQuality: 'w300' | 'w780' | 'w1280' | 'original'
  /** 剧照质量（仅TV） */
  stillQuality?: 'w185' | 'w300' | 'w500' | 'original'
  /** 是否覆盖现有文件 */
  overwriteExisting: boolean
  /** 语言偏好 */
  language: string
  /** 是否自动匹配 */
  autoMatch: boolean
  /** 匹配阈值 */
  matchThreshold: number
}

/**
 * 刮削结果接口
 */
export interface ScrapeResult {
  /** 是否成功 */
  success: boolean
  /** 匹配的媒体信息 */
  mediaInfo?: {
    /** 媒体ID */
    id: number
    /** 标题 */
    title: string
    /** 年份 */
    year?: number
    /** 海报路径 */
    posterPath?: string
  }
  /** 下载的文件列表 */
  downloadedFiles: DownloadedFile[]
  /** 生成的NFO文件列表 */
  generatedNFOs: string[]
  /** 处理时长（毫秒） */
  processingTime: number
  /** 错误信息 */
  error?: string
  /** 警告信息 */
  warnings: string[]
}

/**
 * 下载文件信息接口
 */
export interface DownloadedFile {
  /** 文件类型 */
  type: 'poster' | 'fanart' | 'season_poster' | 'episode_still' | 'logo' | 'backdrop'
  /** 本地文件路径 */
  localPath: string
  /** 远程URL */
  remoteUrl: string
  /** 文件大小（字节） */
  size: number
  /** 下载时间（毫秒） */
  downloadTime: number
}

/**
 * 队列统计信息接口
 */
export interface QueueStats {
  /** 总项目数 */
  total: number
  /** 等待中数量 */
  pending: number
  /** 处理中数量 */
  processing: number
  /** 已完成数量 */
  completed: number
  /** 失败数量 */
  failed: number
  /** 已跳过数量 */
  skipped: number
  /** 已取消数量 */
  cancelled: number
  /** 成功率 */
  successRate: number
  /** 平均处理时间（毫秒） */
  averageProcessingTime: number
  /** 总处理时间（毫秒） */
  totalProcessingTime: number
}

/**
 * 队列配置接口
 */
export interface QueueConfig {
  /** 最大并发数 */
  maxConcurrency: number
  /** 自动处理 */
  autoProcess: boolean
  /** 失败时自动重试 */
  autoRetry: boolean
  /** 默认最大重试次数 */
  defaultMaxRetries: number
  /** 重试延迟（毫秒） */
  retryDelay: number
  /** 处理超时时间（毫秒） */
  processingTimeout: number
  /** 是否保存已完成的项目 */
  keepCompletedItems: boolean
  /** 已完成项目保留时间（小时） */
  completedItemRetentionHours: number
}

/**
 * 队列事件类型枚举
 */
export enum QueueEventType {
  /** 项目添加 */
  ITEM_ADDED = 'item_added',
  /** 项目移除 */
  ITEM_REMOVED = 'item_removed',
  /** 项目状态更新 */
  ITEM_STATUS_UPDATED = 'item_status_updated',
  /** 项目进度更新 */
  ITEM_PROGRESS_UPDATED = 'item_progress_updated',
  /** 队列开始处理 */
  QUEUE_STARTED = 'queue_started',
  /** 队列暂停 */
  QUEUE_PAUSED = 'queue_paused',
  /** 队列恢复 */
  QUEUE_RESUMED = 'queue_resumed',
  /** 队列停止 */
  QUEUE_STOPPED = 'queue_stopped',
  /** 队列清空 */
  QUEUE_CLEARED = 'queue_cleared',
  /** 批次完成 */
  BATCH_COMPLETED = 'batch_completed'
}

/**
 * 队列事件接口
 */
export interface QueueEvent {
  /** 事件类型 */
  type: QueueEventType
  /** 事件数据 */
  data?: any
  /** 事件时间戳 */
  timestamp: number
  /** 队列ID */
  queueId?: string
  /** 项目ID */
  itemId?: string
}

/**
 * 队列过滤器接口
 */
export interface QueueFilter {
  /** 状态过滤 */
  status?: QueueItemStatus[]
  /** 媒体类型过滤 */
  mediaType?: MediaType[]
  /** 优先级过滤 */
  priority?: QueuePriority[]
  /** 日期范围过滤 */
  dateRange?: {
    /** 开始日期 */
    start: string
    /** 结束日期 */
    end: string
  }
  /** 搜索关键词 */
  searchQuery?: string
}

/**
 * 队列排序选项接口
 */
export interface QueueSortOptions {
  /** 排序字段 */
  field: 'createdAt' | 'priority' | 'status' | 'fileName' | 'progress'
  /** 排序方向 */
  direction: 'asc' | 'desc'
}

/**
 * 批量操作类型枚举
 */
export enum BatchOperationType {
  /** 删除 */
  DELETE = 'delete',
  /** 重试 */
  RETRY = 'retry',
  /** 取消 */
  CANCEL = 'cancel',
  /** 更改优先级 */
  CHANGE_PRIORITY = 'change_priority',
  /** 更改配置 */
  CHANGE_CONFIG = 'change_config'
}

/**
 * 批量操作参数接口
 */
export interface BatchOperationParams {
  /** 操作类型 */
  type: BatchOperationType
  /** 项目ID列表 */
  itemIds: string[]
  /** 操作参数 */
  params?: {
    /** 新优先级（更改优先级时使用） */
    priority?: QueuePriority
    /** 新配置（更改配置时使用） */
    config?: Partial<ScrapeConfig>
  }
}

/**
 * 批量操作结果接口
 */
export interface BatchOperationResult {
  /** 是否成功 */
  success: boolean
  /** 成功处理的项目数 */
  successCount: number
  /** 失败处理的项目数 */
  failureCount: number
  /** 失败的项目ID列表 */
  failedItems: string[]
  /** 错误信息 */
  errors: string[]
}

/**
 * 队列导出选项接口
 */
export interface QueueExportOptions {
  /** 导出格式 */
  format: 'json' | 'csv' | 'xlsx'
  /** 包含的字段 */
  fields: string[]
  /** 过滤器 */
  filter?: QueueFilter
  /** 是否包含结果详情 */
  includeResults: boolean
  /** 是否包含配置信息 */
  includeConfig: boolean
}

/**
 * 队列导入选项接口
 */
export interface QueueImportOptions {
  /** 导入格式 */
  format: 'json' | 'csv'
  /** 是否覆盖现有项目 */
  overwriteExisting: boolean
  /** 是否验证文件路径 */
  validateFilePaths: boolean
  /** 默认配置 */
  defaultConfig: ScrapeConfig
}