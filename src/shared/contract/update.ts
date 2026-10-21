import { call, defineDomain, event } from './define'

/** 检查 / 下载更新的结果（沿用旧形状，渲染层按 success 分支） */
export interface UpdateResult {
  success: boolean
  data?: unknown
  error?: string
}

/** electron-updater 推送的状态 */
export type UpdateStatusEvent =
  | { status: 'checking' }
  | {
      status: 'available' | 'not-available' | 'downloaded'
      info: { version?: string }
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
  },
  {
    /** 更新状态变化 */
    status: event<UpdateStatusEvent>(),
  }
)
