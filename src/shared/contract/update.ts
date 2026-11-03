import { call, defineDomain, event } from './define'

/** 检查 / 下载更新的结果（沿用旧形状，渲染层按 success 分支） */
export interface UpdateResult {
  success: boolean
  data?: unknown
  error?: string
}

/** 版本发布说明可能是正文，也可能按版本分组。 */
export interface UpdateInfo {
  version?: string
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null
}

/** electron-updater 推送的状态 */
export type UpdateStatusEvent =
  | { status: 'checking' }
  | {
      status: 'available' | 'not-available' | 'downloaded'
      info: UpdateInfo
    }
  | { status: 'downloading'; progress: { percent?: number } }
  | { status: 'error'; error: string }

/** 自动更新（GitHub Releases）。 */
export const update = defineDomain(
  'update',
  {
    /** 检查更新（开发环境直接返回失败） */
    check: call<UpdateResult>(),
    /** 下载已发现的更新 */
    download: call<UpdateResult>(),
    /** 退出并安装 */
    install: call<void>(),
    /** 当前进程的更新状态与已安装版本，供窗口加载后恢复。 */
    snapshot: call<{
      status: UpdateStatusEvent | null
      info: UpdateInfo | null
      currentVersion: string
    }>(),
  },
  {
    /** 更新状态变化 */
    status: event<UpdateStatusEvent>(),
  }
)
