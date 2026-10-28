/**
 * 媒体库 IPC 契约 · 推送事件：条目 / 媒体库变化、任务、识别与写出进度。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */
import type { LibraryInfo } from './contract'
import type { ActorsChangedEvent } from './contract-actors'

/** 任务状态。 */
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** 当前排队或运行中的媒体库任务。 */
export interface ActiveLibraryJob {
  jobId: number
  jobType: string
  state: 'queued' | 'running'
  libraryId: number | null
  batchId: number | null
}

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
  | ActorsChangedEvent

/** 单个 items-changed 事件里 id 总数的上限，超过就改发 reset。 */
export const ITEMS_CHANGED_LIMIT = 1000
