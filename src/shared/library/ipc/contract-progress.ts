/**
 * 媒体库 IPC 契约 · 观看进度：片库条目（电影 / 一集）的播放位置、时长、是否看完、最后观看时间。
 *
 * 进度存在片库数据库（watch_progress，迁移 v9），桌面端引擎与独立片库服务（网页 / NAS）各存一份，
 * 同一套方法读写；桌面端配了片库服务时由主进程按 updatedAt 后写胜出双向合并（progress.export / import）。
 * 只有类型和常量，由 contract.ts 统一再导出；合并与判定规则在 shared/library/watch-progress.ts。
 */

/** 一条观看进度（条目是电影或一集）。 */
export interface WatchProgress {
  itemId: number
  /** 播放的那个视频文件（分段电影、多版本时有用）；不知道为 null。 */
  fileId: number | null
  /** 播放位置（秒）。 */
  position: number
  /** 总时长（秒）；不知道为 0。 */
  duration: number
  /** 看完：播到结尾或过了 WATCHED_RATIO，之后从头再看也保留，直到手动标成未看。 */
  watched: boolean
  /** 最后观看（或手动标记）的时间，毫秒时间戳；合并时后写胜出。 */
  updatedAt: number
}

/** 播放器上报的一次进度。 */
export interface ProgressReport {
  itemId: number
  fileId?: number | null
  position: number
  duration: number
  /** 播到结尾（ended）。 */
  ended?: boolean
  /** 手动标记看完（true）/ 未看（false）；不给按位置判断。 */
  watched?: boolean
  /** 发生时间（毫秒）；不给用引擎收到的时间。迁移旧的本地记录时带原时间。 */
  at?: number
}

/** 海报墙一张卡的观看概况（顶层条目：电影或剧）。 */
export interface ProgressSummary {
  itemId: number
  /** 电影看完，或剧里每一集有文件的都看完了。 */
  watched: boolean
  /** 0–1：电影是播放位置 / 时长，剧是看完的集数 / 有文件的集数。 */
  ratio: number
  updatedAt: number
}

/** 「继续看」候选：每个顶层条目最近的一条进度。 */
export interface RecentProgress extends WatchProgress {
  /** 所属顶层条目（电影本身 / 剧）。 */
  rootId: number
  libraryId: number
}

/**
 * 跨库同步的一条进度。两边的条目 id 不同，用可移植的键对上：
 * `tv:<剧的 TMDB id>:<季>:<集>`、`movie:<TMDB id>`，都没有时 `fp:<文件指纹>`。
 */
export interface ProgressSyncEntry {
  key: string
  position: number
  duration: number
  watched: boolean
  updatedAt: number
}

/** progress.import 的结果。 */
export interface ProgressImportResult {
  /** 写进来（比本地新）的条数。 */
  applied: number
  /** 本地对不上条目、跳过的条数。 */
  unmatched: number
  /** 写进来的条目 id（渲染层据此刷新）。 */
  itemIds: number[]
}

/** 一次最多上报 / 查询 / 导入多少条。 */
export const PROGRESS_BATCH_LIMIT = 5000

/** 观看进度的方法。 */
export interface ProgressRpcMap {
  /** 这些条目及其下属（剧 → 季 → 集）的进度。 */
  'progress.list': { params: { itemIds: number[] }; result: WatchProgress[] }
  /** 写入上报（按条目合并，见 applyReport），返回写入后的进度。 */
  'progress.save': {
    params: { reports: ProgressReport[] }
    result: WatchProgress[]
  }
  /** 海报墙：顶层条目的观看概况；没看过的不返回。 */
  'progress.summary': {
    params: { itemIds: number[] }
    result: ProgressSummary[]
  }
  /** 最近观看的顶层条目（每个一条，最近的在前）。 */
  'progress.recent': { params: { limit?: number }; result: RecentProgress[] }
  /** 导出能对上跨库键的进度（updatedAt ≥ since）。 */
  'progress.export': {
    params: { since?: number }
    result: ProgressSyncEntry[]
  }
  /** 导入：比本地新的才写；同一时间戳 preferIncoming 为真时以导入的为准。 */
  'progress.import': {
    params: { entries: ProgressSyncEntry[]; preferIncoming?: boolean }
    result: ProgressImportResult
  }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const PROGRESS_METHODS = [
  'progress.list',
  'progress.save',
  'progress.summary',
  'progress.recent',
  'progress.export',
  'progress.import',
] as const satisfies readonly (keyof ProgressRpcMap)[]

/** window.api.library 上的观看进度方法。 */
export interface LibraryProgressBridge {
  progress: {
    list(itemIds: number[]): Promise<WatchProgress[]>
    save(reports: ProgressReport[]): Promise<WatchProgress[]>
    summary(itemIds: number[]): Promise<ProgressSummary[]>
    recent(limit?: number): Promise<RecentProgress[]>
  }
}
