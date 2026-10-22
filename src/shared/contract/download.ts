import { call, defineDomain, event, str } from './define'

/** 下载任务状态。 */
export type DownloadStatus = 'queued' | 'active' | 'done' | 'failed'

/** 一个下载任务（以大写番号为 id）。 */
export interface DownloadTask {
  id: string
  status: DownloadStatus
  /** 命中的站点 */
  site?: string
  /** 完成后的文件路径 */
  file?: string
  error?: string
  /** 进度：done / total 是分片数（HLS）或字节数（直链）；总量未知时没有 total */
  progress?: { done: number; total?: number; bytes: number }
  /** 毫秒时间戳 */
  updatedAt: number
}

/** 队列快照：进行中 / 等待中 / 最近完成 / 失败。 */
export interface DownloadSnapshot {
  active?: DownloadTask
  queued: DownloadTask[]
  completed: DownloadTask[]
  failed: DownloadTask[]
}

/** 加入队列的结果。 */
export type AddResult =
  | { added: true }
  | { added: false; reason: 'invalid' | 'exists' | 'queued' | 'full' }

/** 下载域：番号 → 多站点解析 → HLS 下载 →（有 ffmpeg 时）转 mp4。取代 Go 队列 + Python 下载器。 */
export const download = defineDomain(
  'download',
  {
    /** 当前队列快照 */
    list: call<DownloadSnapshot>(),
    /** 加入队列（已下载 / 已在队列时不重复加） */
    add: call<[code: string], AddResult>(a => [str(a[0], 'code')]),
    /** 从队列或记录里移除（进行中的任务会被取消） */
    remove: call<[code: string], void>(a => [str(a[0], 'code')]),
    /** 失败任务重新排队 */
    retry: call<[code: string], AddResult>(a => [str(a[0], 'code')]),
  },
  {
    /** 队列变化（含进度，节流推送） */
    changed: event<DownloadSnapshot>(),
  }
)
