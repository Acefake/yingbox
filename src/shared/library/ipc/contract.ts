/**
 * 媒体库引擎的 IPC 契约：渲染进程经 preload 调用的方法、请求 / 响应形状和推送事件。
 *
 * 只有类型和常量，不依赖 Node / Electron，主进程、引擎进程、preload、渲染进程共用。
 */
import type {
  EpisodeMetadata,
  MediaMetadata,
  SeasonMetadata,
} from '../provider'
import type { ActorRpcMap, LibraryActorsBridge } from './contract-actors'
import { ACTOR_METHODS } from './contract-actors'
import type { CalendarRpcMap, LibraryCalendarBridge } from './contract-calendar'
import { CALENDAR_METHODS } from './contract-calendar'
import type { LibraryProgressBridge, ProgressRpcMap } from './contract-progress'
import { PROGRESS_METHODS } from './contract-progress'
import type { LibraryEvent } from './contract-events'
import type { LibraryMergeBridge, MergeRpcMap } from './contract-merge'
import { MERGE_METHODS, type NodeMergeFields } from './contract-merge'
import type { LibraryQueryFilters } from './contract-filters'
import type {
  FacetFilter,
  FacetRpcMap,
  LibraryFacetsBridge,
} from './contract-facets'
import { FACET_METHODS } from './contract-facets'
import type { LibraryVisualBridge, VisualRpcMap } from './contract-visual'
import { VISUAL_METHODS } from './contract-visual'
import type {
  ApplyMatchRequest,
  ApplyMatchResult,
  MatchCandidatesResult,
} from './contract-match'
import type { JavSettings, LibrarySource } from './contract-jav'
import type { VideoProbe, VideoRange } from '../../video-range'
import type {
  JavCredentialProvider,
  ProviderStatus,
  SetProviderTokenRequest,
} from './contract-provider'
import type {
  AddLibraryRequest,
  ItemPreview,
  LibraryAutomation,
  LibraryNotifyRpcMap,
  UpdateLibraryRequest,
} from './contract-library'
import type {
  LibraryWriterBridge,
  OrganizeAccepted,
  OrganizeBatchInfo,
  OrganizePlan,
  WriterSettings,
} from './contract-writer'

export * from './contract-actors'
export * from './contract-calendar'
export * from './contract-progress'
export * from './contract-events'
export * from './contract-http'
export * from './contract-facets'
export * from './contract-filters'
export * from './contract-visual'
export * from './contract-jav'
export * from './contract-match'
export * from './contract-provider'
export * from './contract-library'
export * from './contract-writer'

/** 媒体库类型：电影库或剧集库，决定本地分组方式和后续用哪类元数据源识别。 */
export type LibraryKind = 'movie' | 'tv'

/** 媒体条目层级。电影与剧集是顶层条目，季与集挂在剧集下面。 */
export type MediaItemType = 'movie' | 'series' | 'season' | 'episode'

/** 顶层条目类型（海报墙展示的那一层）。 */
export type TopLevelItemType = Extract<MediaItemType, 'movie' | 'series'>

/**
 * 匹配状态：
 * - auto：高置信度自动匹配；
 * - review：有候选但置信度不够，等用户确认；
 * - unmatched：尚未识别或没有候选；
 * - locked：用户手动确认 / 指定，之后的扫描和识别都不改动。
 */
export type MatchState = 'auto' | 'review' | 'unmatched' | 'locked'

/** 媒体库文件分类：视频，或旁挂的 nfo / 图片。 */
export type LibraryFileKind = 'video' | 'nfo' | 'image'

/** 一个已添加的媒体库。 */
export interface LibraryInfo {
  id: number
  /** 显示名，默认取根目录名。 */
  name: string
  /** 根目录（原始系统路径）。 */
  root: string
  kind: LibraryKind
  /** 元数据来源：tmdb 按片名识别，jav 按番号刮削（只用于电影库）。 */
  source: LibrarySource
  /** 毫秒时间戳。 */
  createdAt: number
  /** 最近一次扫描完成的时间；从未扫描为 null。 */
  lastScanAt: number | null
  /** 自动化：监控、自动识别、自动写出、自动整理、存储。 */
  automation: LibraryAutomation
  /** 实际是否按网盘处理（storage 为 auto 时是判定结果）；还没判定完时缺省。 */
  cloud?: boolean
}

/** 外部数据库 ID；尚未识别时为空对象。 */
export interface ProviderIds {
  tmdb?: string
  imdb?: string
  tvdb?: string
}

/** 列表里的一条顶层条目（海报墙一格所需的全部字段）。 */
export interface LibraryItemSummary {
  id: number
  libraryId: number
  type: MediaItemType
  title: string
  originalTitle: string | null
  year: number | null
  matchState: MatchState
  providerIds: ProviderIds
  /**
   * 海报：已缓存时为 yingbox-media://image/<key>（加 ?w=300 / ?w=780 取缩略图，见 mediaImageUrl），
   * 缓存失败时为 TMDB 远程地址；未识别为 null。
   */
  poster: string | null
  /** 背景图，规则同 poster。 */
  backdrop: string | null
  /** 评分 0–10；未识别或无评分为 null。 */
  rating: number | null
  addedAt: number
  updatedAt: number
  /** 视频动态范围（全部文件里最好的一档，见 shared/video-range）；没探测过或没有 ffprobe 时缺省。 */
  videoRange?: VideoRange | null
}

/** 条目关联的一个文件。 */
export interface LibraryItemFile {
  id: number
  path: string
  kind: LibraryFileKind
  size: number
  mtime: number
  /** 视频文件的动态范围探测结果；没探测过 / 读不出时缺省。 */
  video?: VideoProbe | null
}

/** 条目详情树中的一个节点：剧集 → 季 → 集，电影没有子节点；版本与合并信息见 contract-merge.ts。 */
export interface LibraryItemNode extends LibraryItemSummary, NodeMergeFields {
  seasonNumber: number | null
  episodeNumber: number | null
  overview: string | null
  /** 标志图（透明底片名），规则同 poster。 */
  logo: string | null
  /** 时长（分钟）。 */
  runtime: number | null
  genres: string[]
  /** 首映 / 播出日期。 */
  airDate: string | null
  /** 完整元数据（演职员、图片候选、外部 ID 等）；未识别为 null。 */
  metadata: ItemMetadata | null
  files: LibraryItemFile[]
  children: LibraryItemNode[]
}

/** query 可排序字段。 */
export type LibrarySortField =
  | 'title'
  | 'year'
  | 'rating'
  | 'addedAt'
  | 'updatedAt'

/** 列表查询。所有字段可选，缺省时取 normalizeLibraryQuery 的默认值。 */
export interface LibraryQuery extends LibraryQueryFilters {
  /** 只查某个媒体库；缺省查全部。 */
  libraryId?: number
  /** 只要这种来源的媒体库（电影页传 tmdb、番号页传 jav，互不露出）；缺省两种都要。 */
  source?: LibrarySource
  /** 分面筛选（类型 / 标签 / 演员 / 制作商 / 系列 / 导演），见 contract-facets.ts。 */
  facets?: FacetFilter
  /** 顶层类型筛选；缺省电影和剧集都要。 */
  types?: TopLevelItemType[]
  /** 片名搜索（FTS5，繁简与大小写不敏感）。 */
  search?: string
  /** 只要这位演员的作品（演员库）。 */
  actorId?: number
  yearFrom?: number
  yearTo?: number
  matchStates?: MatchState[]
  sort?: LibrarySortField
  /** 默认：title 升序，其余字段降序。 */
  order?: 'asc' | 'desc'
  offset?: number
  /** 每页条数，默认 200，上限 1000。 */
  limit?: number
}

/** 列表查询结果。 */
export interface LibraryQueryResult {
  items: LibraryItemSummary[]
  /** 满足筛选条件的总条数（不受分页影响）。 */
  total: number
  offset: number
  limit: number
}

/** 触发扫描。 */
export interface ScanRequest {
  libraryId: number
  /** 为 true 时不走目录 mtime 短路，逐个 stat 全部文件（怀疑有“只改内容不改目录”的变化时用）。 */
  full?: boolean
}

/** 扫描已排入任务队列。 */
export interface ScanAccepted {
  jobId: number
}

/**
 * 条目上存的完整元数据：电影 / 剧集是 MediaMetadata，季是 SeasonMetadata（不含 episodes），
 * 集是 EpisodeMetadata。绝对集数的集额外带 mapped（映射到的 季 / 集）。
 */
export type ItemMetadata =
  | ({ level: 'title' } & MediaMetadata)
  | ({ level: 'season' } & Omit<SeasonMetadata, 'episodes'>)
  | ({ level: 'episode' } & EpisodeMetadata & { mapped?: boolean })

/** 识别请求：给 itemIds 只识别这些条目；只给 libraryId 识别该库里需要识别的条目。 */
export interface IdentifyRequest {
  libraryId?: number
  itemIds?: number[]
  /** 为 true 时已自动匹配 / 待确认的也重新识别（锁定的永远不动）。 */
  force?: boolean
  /**
   * 为 true 时只对其中待确认 / 未匹配的条目做 AI 识别（大模型推断片名后经 TMDB 验证），
   * 不受设置「AI 识别兜底」开关影响；没有配置 AI 时报错。
   */
  ai?: boolean
}

/** 刷新元数据：重新拉取已匹配条目（含锁定）的元数据与图片，不改匹配。 */
export interface RefreshMetadataRequest {
  libraryId?: number
  itemIds?: number[]
}

/** 任务已排入队列。 */
export interface JobAccepted {
  jobId: number
}

/** 渲染进程可调用的方法：方法名 → 参数与返回值。 */
export interface LibraryRpcMap
  extends
    ActorRpcMap,
    CalendarRpcMap,
    ProgressRpcMap,
    FacetRpcMap,
    MergeRpcMap,
    VisualRpcMap,
    LibraryNotifyRpcMap {
  listLibraries: { params: void; result: LibraryInfo[] }
  addLibrary: { params: AddLibraryRequest; result: LibraryInfo }
  removeLibrary: { params: { libraryId: number }; result: void }
  updateLibrary: { params: UpdateLibraryRequest; result: LibraryInfo }
  scan: { params: ScanRequest; result: ScanAccepted }
  query: { params: LibraryQuery; result: LibraryQueryResult }
  getItem: { params: { itemId: number }; result: LibraryItemNode | null }
  getPreview: { params: { itemId: number }; result: ItemPreview | null }
  identify: { params: IdentifyRequest; result: JobAccepted }
  getMatchCandidates: {
    params: { itemId: number }
    result: MatchCandidatesResult
  }
  applyMatch: { params: ApplyMatchRequest; result: ApplyMatchResult }
  lockMatch: { params: { itemId: number }; result: LibraryItemSummary }
  unlockMatch: { params: { itemId: number }; result: LibraryItemSummary }
  refreshMetadata: { params: RefreshMetadataRequest; result: JobAccepted }
  setProviderToken: { params: SetProviderTokenRequest; result: ProviderStatus }
  getProviderStatus: { params: void; result: ProviderStatus }
  'writer.getSettings': { params: void; result: WriterSettings }
  'writer.setSettings': { params: WriterSettings; result: WriterSettings }
  'writer.write': { params: { itemIds: number[] }; result: JobAccepted }
  'writer.previewOrganize': {
    params: { itemIds: number[] }
    result: OrganizePlan
  }
  'writer.applyOrganize': {
    params: { planId: string }
    result: OrganizeAccepted
  }
  'writer.undoOrganize': { params: { batchId: number }; result: JobAccepted }
  'writer.listOrganizeBatches': { params: void; result: OrganizeBatchInfo[] }
  'jav.getSettings': { params: void; result: JavSettings }
  'jav.setSettings': { params: JavSettings; result: JavSettings }
}

/** 方法名。 */
export type LibraryMethod = keyof LibraryRpcMap

/** 方法名白名单：主进程据此拒绝未知方法，键与 LibraryRpcMap 一一对应。 */
export const LIBRARY_METHODS = [
  'listLibraries',
  'addLibrary',
  'removeLibrary',
  'updateLibrary',
  'scan',
  'query',
  'getItem',
  'getPreview',
  'identify',
  'getMatchCandidates',
  'applyMatch',
  'lockMatch',
  'unlockMatch',
  'refreshMetadata',
  'setProviderToken',
  'getProviderStatus',
  'notifyChanges',
  'writer.getSettings',
  'writer.setSettings',
  'writer.write',
  'writer.previewOrganize',
  'writer.applyOrganize',
  'writer.undoOrganize',
  'writer.listOrganizeBatches',
  'jav.getSettings',
  'jav.setSettings',
  ...ACTOR_METHODS,
  ...FACET_METHODS,
  ...VISUAL_METHODS,
  ...CALENDAR_METHODS,
  ...PROGRESS_METHODS,
  ...MERGE_METHODS,
] as const satisfies readonly LibraryMethod[]

/**
 * 渲染进程看到的 window.api.library。
 * 方法失败时 reject 一个 Error，错误码用 libraryErrorCode(error) 取（见 wire.ts）。
 */
export interface LibraryBridge
  extends
    LibraryFacetsBridge,
    LibraryVisualBridge,
    LibraryCalendarBridge,
    LibraryProgressBridge,
    LibraryMergeBridge {
  listLibraries(): Promise<LibraryInfo[]>
  addLibrary(request: AddLibraryRequest): Promise<LibraryInfo>
  removeLibrary(libraryId: number): Promise<void>
  /** 改名或改自动化设置，返回生效后的媒体库。 */
  updateLibrary(request: UpdateLibraryRequest): Promise<LibraryInfo>
  scan(request: ScanRequest): Promise<ScanAccepted>
  query(query?: LibraryQuery): Promise<LibraryQueryResult>
  getItem(itemId: number): Promise<LibraryItemNode | null>
  /** 海报墙悬停预览：本地视频或已缓存图片；条目不存在为 null。 */
  getPreview(itemId: number): Promise<ItemPreview | null>
  /** 识别条目（排队执行，进度见 identify-progress 事件）。 */
  identify(request: IdentifyRequest): Promise<JobAccepted>
  getMatchCandidates(itemId: number): Promise<MatchCandidatesResult>
  applyMatch(request: ApplyMatchRequest): Promise<ApplyMatchResult>
  lockMatch(itemId: number): Promise<LibraryItemSummary>
  unlockMatch(itemId: number): Promise<LibraryItemSummary>
  refreshMetadata(request: RefreshMetadataRequest): Promise<JobAccepted>
  /**
   * 元数据源配置状态。TMDB 令牌由主进程下发给引擎（src/main/tmdb.ts），
   * 渲染层改令牌走 settings.setSecret，桌面端 bridge 不提供 setProviderToken。
   */
  getProviderStatus(): Promise<ProviderStatus>
  /**
   * 设置 TMDB 令牌（null 清除）。只有独立服务的网页端 transport 提供：
   * 网页端没有主进程与设置密钥，令牌由服务存进它自己的密钥文件并下发给片库。
   */
  setProviderToken?(token: string | null): Promise<ProviderStatus>
  /** 写出层：NFO / 图片 / 整理（改名移动）。进度见 writer-progress 事件。 */
  writer: LibraryWriterBridge
  /** 番号站点设置（开关与优先级）与站点凭据。 */
  jav: {
    getSettings(): Promise<JavSettings>
    setSettings(settings: JavSettings): Promise<JavSettings>
    /** 设置 / 清除（null）一个番号站点的凭据，返回配置状态（不回传凭据本身）。 */
    setCredential(
      provider: JavCredentialProvider,
      value: string | null
    ): Promise<ProviderStatus>
  }
  /** 演员库：列表、详情、编辑锁定、刷新资料、来源设置。 */
  actors: LibraryActorsBridge
  /** 订阅引擎事件，返回取消订阅函数。事件经 MessagePort 直达，不经主进程转发。 */
  subscribe(listener: (event: LibraryEvent) => void): () => void
}
