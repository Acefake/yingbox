/**
 * 媒体库引擎的 IPC 契约：渲染进程经 preload 调用的方法、请求 / 响应形状和推送事件。
 *
 * 只有类型和常量，不依赖 Node / Electron，主进程、引擎进程、preload、渲染进程共用。
 */
import type {
  EpisodeMetadata,
  MediaKind,
  MediaMetadata,
  SeasonMetadata,
} from '../provider'
import { DEFAULT_MOVIE_TEMPLATE, DEFAULT_TV_TEMPLATE } from '../writer/template'

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

/** 一个匹配候选（待确认列表、手动搜索结果）。 */
export interface MatchCandidateInfo {
  provider: 'tmdb'
  kind: MediaKind
  id: string
  title: string
  originalTitle: string | null
  year: number | null
  /** 0–1。 */
  confidence: number
  /** 各信号得分（title / year / runtime / episodes）。 */
  breakdown: Record<string, number>
  /** TMDB 海报远程地址（w185），候选还没缓存，直接用远程图。 */
  poster: string | null
}

/** 某条目当前的匹配与候选。 */
export interface MatchCandidatesResult {
  itemId: number
  matchState: MatchState
  /** 当前匹配（auto / locked）；没有为 null。 */
  current: MatchCandidateInfo | null
  /** 待确认 / 未匹配时保存的前几名候选。 */
  candidates: MatchCandidateInfo[]
}

/**
 * 手动匹配：三选一——
 * - tmdbId：直接指定（kind 缺省取条目类型）；
 * - imdbId / tvdbId：反查后指定；
 * - query：用给定标题（和年份）重新搜索打分，够自信自动应用，否则返回候选。
 */
export interface ApplyMatchRequest {
  itemId: number
  tmdbId?: string
  imdbId?: string
  tvdbId?: string
  query?: { title: string; year?: number }
  /** 指定 id 时是否锁定，默认 true（手动选择的结果之后不被自动识别覆盖）。 */
  lock?: boolean
}

/** 手动匹配结果。 */
export interface ApplyMatchResult {
  status: 'matched' | 'review' | 'unmatched'
  item: LibraryItemSummary | null
  candidates: MatchCandidateInfo[]
}

/** 设置元数据源令牌；token 为 null 或空串表示清除。 */
export interface SetProviderTokenRequest {
  provider: 'tmdb' | 'opensubtitles'
  token: string | null
}

/** 元数据源配置状态（不回传令牌本身）。 */
export interface ProviderStatus {
  tmdb: { configured: boolean }
  opensubtitles: { configured: boolean }
}

// —————————————————————————— 写出层（P5）——————————————————————————

/**
 * 写出设置：NFO、图片、识别后自动写出、整理（改名移动）。
 * 整理默认关闭；开启后也必须先 previewOrganize 预览，再 applyOrganize 执行，可 undoOrganize 撤销。
 */
export interface WriterSettings {
  nfo: {
    enabled: boolean
    /**
     * merge：保留已有 NFO 里用户手改过的字段和其他工具写的未知字段，只补 / 更新我们上次写的部分；
     * overwrite：整份重写。两种模式都尊重 Jellyfin / Emby 的 <lockdata>true</lockdata>（不动该文件）。
     */
    mode: 'merge' | 'overwrite'
  }
  artwork: {
    poster: boolean
    fanart: boolean
    /** clearlogo.png。 */
    logo: boolean
    /** 季海报（seasonXX-poster.jpg）与集缩略图（<集>-thumb.jpg）。 */
    seasonArt: boolean
    /** 演员头像写到 .actors/。 */
    actors: boolean
    /** 额外写旧命名（folder.jpg、<名>-movie.jpg、<名>-folder.jpg），兼容老播放器。 */
    legacyNames: boolean
  }
  /** 识别 / 手动匹配完成后自动写出 NFO 与图片。 */
  autoWriteAfterIdentify: boolean
  organize: {
    /** 默认 false：关闭时 applyOrganize 被拒绝（预览仍可用）。 */
    enabled: boolean
    /** 相对媒体库根目录的电影路径模板，变量见 TEMPLATE_VARIABLES。 */
    movieTemplate: string
    /** 相对媒体库根目录的剧集单集路径模板。 */
    tvTemplate: string
  }
}

/** 写出设置默认值。 */
export const DEFAULT_WRITER_SETTINGS: WriterSettings = {
  nfo: { enabled: true, mode: 'merge' },
  artwork: {
    poster: true,
    fanart: true,
    logo: true,
    seasonArt: true,
    actors: false,
    legacyNames: false,
  },
  autoWriteAfterIdentify: false,
  organize: {
    enabled: false,
    movieTemplate: DEFAULT_MOVIE_TEMPLATE,
    tvTemplate: DEFAULT_TV_TEMPLATE,
  },
}

/** 整理计划里一项的类型：视频本体、跟随视频的旁挂文件（字幕 / nfo / 图片）、文件夹级文件或目录。 */
export type OrganizeEntryKind = 'video' | 'sidecar' | 'folder'

/** 整理计划的一项移动。 */
export interface OrganizeEntry {
  /** 所属顶层条目（电影 / 剧集）。 */
  itemId: number
  kind: OrganizeEntryKind
  /** 当前路径（系统路径）。 */
  from: string
  /** 目标路径。 */
  to: string
  /** 有值表示这一项不会执行，值是原因（目标已存在、两个文件撞名、路径过长……）。 */
  conflict?: string
  /** 跨盘：执行时走 复制 → 校验 → 删除，比同盘改名慢得多。 */
  crossDevice: boolean
}

/** previewOrganize 的结果：计划在引擎里保留 30 分钟，applyOrganize 凭 planId 执行。 */
export interface OrganizePlan {
  planId: string
  entries: OrganizeEntry[]
  /** 不需要移动（已经符合模板）的视频数。 */
  unchanged: number
}

/** applyOrganize 的结果。 */
export interface OrganizeAccepted {
  batchId: number
  jobId: number
}

/** 整理批次状态。 */
export type OrganizeBatchState =
  | 'running'
  | 'done'
  | 'partial'
  | 'failed'
  | 'undoing'
  | 'undone'

/** 一个整理批次（执行记录，可撤销）。 */
export interface OrganizeBatchInfo {
  batchId: number
  state: OrganizeBatchState
  createdAt: number
  finishedAt: number | null
  undoneAt: number | null
  /** 计划里要执行的项数（不含冲突项）。 */
  total: number
  moved: number
  failed: number
  itemIds: number[]
  /** 最后一个错误。 */
  error: string | null
}

/** 渲染进程可调用的方法：方法名 → 参数与返回值。 */
export interface LibraryRpcMap {
  listLibraries: { params: void; result: LibraryInfo[] }
  addLibrary: { params: AddLibraryRequest; result: LibraryInfo }
  removeLibrary: { params: { libraryId: number }; result: void }
  scan: { params: ScanRequest; result: ScanAccepted }
  query: { params: LibraryQuery; result: LibraryQueryResult }
  getItem: { params: { itemId: number }; result: LibraryItemNode | null }
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
  'identify',
  'getMatchCandidates',
  'applyMatch',
  'lockMatch',
  'unlockMatch',
  'refreshMetadata',
  'setProviderToken',
  'getProviderStatus',
  'writer.getSettings',
  'writer.setSettings',
  'writer.write',
  'writer.previewOrganize',
  'writer.applyOrganize',
  'writer.undoOrganize',
  'writer.listOrganizeBatches',
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

/** 识别 / 刷新元数据进度（节流推送，最后一次 finished 为 true）。 */
export interface IdentifyProgressEvent {
  type: 'identify-progress'
  jobId: number
  /** 'identify' 或 'refresh'。 */
  mode: 'identify' | 'refresh'
  libraryId: number | null
  total: number
  done: number
  matched: number
  review: number
  unmatched: number
  failed: number
  finished: boolean
  /** 失败原因（如令牌无效）。 */
  error?: string
}

/**
 * 写出 / 整理 / 撤销进度（节流推送，最后一次 finished 为 true）。
 * write 模式按文件计数：written 实际写入、skipped 内容未变或被 lockdata 锁定、failed 失败；
 * organize / undo 模式按移动项计数（skipped 为源文件已不在等跳过的项）。
 */
export interface WriterProgressEvent {
  type: 'writer-progress'
  jobId: number
  mode: 'write' | 'organize' | 'undo'
  /** organize / undo 时的批次。 */
  batchId?: number
  total: number
  done: number
  written: number
  skipped: number
  failed: number
  finished: boolean
  error?: string
}

/** 引擎经 MessagePort 推给订阅方的事件。 */
export type LibraryEvent =
  | ItemsChangedEvent
  | LibrariesChangedEvent
  | JobEvent
  | IdentifyProgressEvent
  | WriterProgressEvent

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
  /** 识别条目（排队执行，进度见 identify-progress 事件）。 */
  identify(request: IdentifyRequest): Promise<JobAccepted>
  getMatchCandidates(itemId: number): Promise<MatchCandidatesResult>
  applyMatch(request: ApplyMatchRequest): Promise<ApplyMatchResult>
  lockMatch(itemId: number): Promise<LibraryItemSummary>
  unlockMatch(itemId: number): Promise<LibraryItemSummary>
  refreshMetadata(request: RefreshMetadataRequest): Promise<JobAccepted>
  /** 设置 / 清除元数据源令牌，持久化在引擎侧。 */
  setProviderToken(
    provider: SetProviderTokenRequest['provider'],
    token: string | null
  ): Promise<ProviderStatus>
  getProviderStatus(): Promise<ProviderStatus>
  /** 写出层：NFO / 图片 / 整理（改名移动）。进度见 writer-progress 事件。 */
  writer: LibraryWriterBridge
  /** 订阅引擎事件，返回取消订阅函数。事件经 MessagePort 直达，不经主进程转发。 */
  subscribe(listener: (event: LibraryEvent) => void): () => void
}

/** window.api.library.writer。 */
export interface LibraryWriterBridge {
  getSettings(): Promise<WriterSettings>
  /** 保存并返回生效的设置；模板不合法时以 invalid-params 拒绝。 */
  setSettings(settings: WriterSettings): Promise<WriterSettings>
  /** 为这些条目（电影 / 剧集，传季 / 集按所属剧集处理）写 NFO 与图片，排队执行。 */
  write(itemIds: number[]): Promise<JobAccepted>
  /** 按模板生成整理计划（只读，不动文件）。 */
  previewOrganize(itemIds: number[]): Promise<OrganizePlan>
  /** 执行计划里没有冲突的项，记录批次日志；整理未开启或计划过期时拒绝。 */
  applyOrganize(planId: string): Promise<OrganizeAccepted>
  /** 按批次日志倒序移回原处。 */
  undoOrganize(batchId: number): Promise<JobAccepted>
  /** 最近的整理批次，新的在前。 */
  listOrganizeBatches(): Promise<OrganizeBatchInfo[]>
}
