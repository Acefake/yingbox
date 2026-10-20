/**
 * 写出层（P5）契约的本地副本：与 P5 约定的方法名、参数、返回值和事件逐字一致。
 *
 * P5 与本 PR 并行开发，合并前 src/shared/library/ipc 还没有这些导出，所以先在这里声明。
 * TODO(P5)：P5 合并后删掉本文件，改从 src/shared/library/ipc 导入同名类型
 * （WriterSettings、OrganizePlan、OrganizeEntry、OrganizeAccepted、OrganizeBatchInfo、
 * WriterProgressEvent、LibraryWriterBridge、DEFAULT_WRITER_SETTINGS）。
 */
import type { JobAccepted } from '../../../../../shared/library/ipc'

/** 写出设置：NFO、图片、识别后自动写出、整理（改名移动，默认关闭）。 */
export interface WriterSettings {
  nfo: {
    enabled: boolean
    /** merge 保留用户手改字段，overwrite 整份重写。 */
    mode: 'merge' | 'overwrite'
  }
  artwork: {
    poster: boolean
    fanart: boolean
    logo: boolean
    /** 季海报与集缩略图。 */
    seasonArt: boolean
    /** 演员头像（.actors/）。 */
    actors: boolean
    /** 额外写旧命名（folder.jpg 等），兼容老播放器。 */
    legacyNames: boolean
  }
  autoWriteAfterIdentify: boolean
  organize: {
    enabled: boolean
    movieTemplate: string
    tvTemplate: string
  }
}

/** 默认电影整理模板（与 P5 template.ts 一致）。 */
export const DEFAULT_MOVIE_TEMPLATE = '{title} ({year})/{title} ({year}).{ext}'

/** 默认剧集整理模板（与 P5 template.ts 一致）。 */
export const DEFAULT_TV_TEMPLATE =
  '{series} ({year})/Season {season:02}/{series} - S{season:02}E{episode:02} - {episodeTitle}.{ext}'

/** 写出设置默认值：引擎不可用时设置页显示它（只读）。 */
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

/** 整理计划的一项移动。conflict 有值表示这一项不会执行。 */
export interface OrganizeEntry {
  itemId: number
  kind?: 'video' | 'sidecar' | 'folder'
  from: string
  to: string
  conflict?: string
  /** 跨盘移动（复制 → 校验 → 删除），比同盘改名慢。 */
  crossDevice: boolean
}

/** previewOrganize 的结果。 */
export interface OrganizePlan {
  planId: string
  entries: OrganizeEntry[]
  /** 已符合模板、不需要移动的视频数。 */
  unchanged?: number
}

/** applyOrganize 的结果。 */
export interface OrganizeAccepted {
  batchId: number
  jobId?: number
}

/** 整理批次状态。 */
export type OrganizeBatchState =
  | 'running'
  | 'done'
  | 'partial'
  | 'failed'
  | 'undoing'
  | 'undone'

/** 一个整理批次（可撤销）。 */
export interface OrganizeBatchInfo {
  batchId: number
  state: OrganizeBatchState
  createdAt: number
  total: number
  moved: number
  failed: number
  itemIds: number[]
  error: string | null
}

/** 写出 / 整理 / 撤销进度事件（经 library.subscribe 推送）。 */
export interface WriterProgressEvent {
  type: 'writer-progress'
  jobId: number
  mode: 'write' | 'organize' | 'undo'
  batchId?: number
  total: number
  done: number
  failed: number
  finished: boolean
  error?: string
}

/** window.api.library.writer。 */
export interface LibraryWriterBridge {
  getSettings(): Promise<WriterSettings>
  setSettings(settings: WriterSettings): Promise<WriterSettings>
  write(itemIds: number[]): Promise<JobAccepted>
  previewOrganize(itemIds: number[]): Promise<OrganizePlan>
  applyOrganize(planId: string): Promise<OrganizeAccepted>
  undoOrganize(batchId: number): Promise<JobAccepted>
  listOrganizeBatches(): Promise<OrganizeBatchInfo[]>
}
