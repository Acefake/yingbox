import { call, defineDomain, event } from './define'
import type { FileResult } from './file'

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
    check: call<FileResult>(),
    /** 下载已发现的更新 */
    download: call<FileResult>(),
    /** 退出并安装 */
    install: call<void>(),
  },
  {
    /** 更新状态变化 */
    status: event<UpdateStatusEvent>(),
  }
)
