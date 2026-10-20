/**
 * 媒体库引擎的 IPC 契约：渲染进程经 preload 调用的方法、请求 / 响应形状和推送事件。
 *
 * 只有类型和常量，不依赖 Node / Electron，主进程、引擎进程、preload、渲染进程共用。
 */

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
  /** 毫秒时间戳。 */
  createdAt: number
  /** 最近一次扫描完成的时间；从未扫描为 null。 */
  lastScanAt: number | null
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
  /** 本地海报路径或远程海报 URL；P3 识别后填充。 */
  poster: string | null
  addedAt: number
  updatedAt: number
}

/** 条目关联的一个文件。 */
export interface LibraryItemFile {
  id: number
  path: string
  kind: LibraryFileKind
  size: number
  mtime: number
}

/** 条目详情树中的一个节点：剧集 → 季 → 集，电影没有子节点。 */
export interface LibraryItemNode extends LibraryItemSummary {
  seasonNumber: number | null
  episodeNumber: number | null
  files: LibraryItemFile[]
  children: LibraryItemNode[]
}

/** query 可排序字段。 */
export type LibrarySortField = 'title' | 'year' | 'addedAt' | 'updatedAt'

/** 列表查询。所有字段可选，缺省时取 normalizeLibraryQuery 的默认值。 */
export interface LibraryQuery {
  /** 只查某个媒体库；缺省查全部。 */
  libraryId?: number
  /** 顶层类型筛选；缺省电影和剧集都要。 */
  types?: TopLevelItemType[]
  /** 片名搜索（FTS5，繁简与大小写不敏感）。 */
  search?: string
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

/** 添加媒体库。 */
export interface AddLibraryRequest {
  root: string
  kind: LibraryKind
  name?: string
}

/** 触发扫描。 */
export interface ScanRequest {
  libraryId: number
  /**
   * 为 true 时不走目录 mtime 短路，逐个 stat 全部文件。
   * 用于怀疑有“只改内容不改目录”的文件变化时。
   */
  full?: boolean
}

/** 扫描已排入任务队列。 */
export interface ScanAccepted {
  jobId: number
}

/** 渲染进程可调用的方法：方法名 → 参数与返回值。 */
export interface LibraryRpcMap {
  listLibraries: { params: void; result: LibraryInfo[] }
  addLibrary: { params: AddLibraryRequest; result: LibraryInfo }
  removeLibrary: { params: { libraryId: number }; result: void }
  scan: { params: ScanRequest; result: ScanAccepted }
  query: { params: LibraryQuery; result: LibraryQueryResult }
  getItem: { params: { itemId: number }; result: LibraryItemNode | null }
}

/** 方法名。 */
export type LibraryMethod = keyof LibraryRpcMap

/** 方法名白名单：主进程据此拒绝未知方法，键与 LibraryRpcMap 一一对应。 */
export const LIBRARY_METHODS = [
  'listLibraries',
  'addLibrary',
  'removeLibrary',
  'scan',
  'query',
  'getItem',
] as const satisfies readonly LibraryMethod[]

/** 任务状态。 */
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** 条目变化（顶层条目 id）。数量过多时只发 reset，让订阅方整体刷新。 */
export interface ItemsChangedEvent {
  type: 'items-changed'
  libraryId: number
  added: number[]
  updated: number[]
  removed: number[]
  /** 为 true 时 added/updated/removed 为空，订阅方应重新查询。 */
  reset: boolean
}

/** 媒体库列表变化（添加 / 删除 / 扫描完成）。 */
export interface LibrariesChangedEvent {
  type: 'libraries-changed'
  libraries: LibraryInfo[]
}

/** 任务进度。 */
export interface JobEvent {
  type: 'job'
  jobId: number
  jobType: string
  state: JobState
  /** 0–1；不可估计时缺省。 */
  progress?: number
  error?: string
}

/** 引擎经 MessagePort 推给订阅方的事件。 */
export type LibraryEvent = ItemsChangedEvent | LibrariesChangedEvent | JobEvent

/** 单个 items-changed 事件里 id 总数的上限，超过就改发 reset。 */
export const ITEMS_CHANGED_LIMIT = 1000

/**
 * 渲染进程看到的 window.api.library。
 * 方法失败时 reject 一个 Error，错误码用 libraryErrorCode(error) 取（见 wire.ts）。
 */
export interface LibraryBridge {
  listLibraries(): Promise<LibraryInfo[]>
  addLibrary(request: AddLibraryRequest): Promise<LibraryInfo>
  removeLibrary(libraryId: number): Promise<void>
  scan(request: ScanRequest): Promise<ScanAccepted>
  query(query?: LibraryQuery): Promise<LibraryQueryResult>
  getItem(itemId: number): Promise<LibraryItemNode | null>
  /** 订阅引擎事件，返回取消订阅函数。事件经 MessagePort 直达，不经主进程转发。 */
  subscribe(listener: (event: LibraryEvent) => void): () => void
}
