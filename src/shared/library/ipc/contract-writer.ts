/**
 * 媒体库 IPC 契约 · 写出层（P5）：写出设置及默认值、整理计划 / 批次的形状。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */
import { DEFAULT_MOVIE_TEMPLATE, DEFAULT_TV_TEMPLATE } from '../writer/template'

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
