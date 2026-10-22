import { call, defineDomain, event } from './define'

/** 外部变更通知端点的状态。 */
export interface LibraryNotifyStatus {
  /** 是否正在监听 */
  running: boolean
  /** 完整地址（含令牌），填进 CloudDrive2 webhook 的 url；没在监听时为 null */
  url: string | null
  /** 启动失败的原因；正常为 null */
  error: string | null
}

/**
 * 媒体库外部变更通知：主进程本地 HTTP 端点（见 src/main/library/notify）。
 * 开关、局域网访问、挂载目录是普通设置（library.notify.*，经 settings.set 写入）；这里只给状态与换令牌。
 */
export const libraryNotify = defineDomain(
  'libraryNotify',
  {
    /** 当前状态 */
    status: call<LibraryNotifyStatus>(),
    /** 换一个新令牌（旧地址立即失效），返回新状态 */
    resetToken: call<LibraryNotifyStatus>(),
  },
  {
    /** 状态变化（开关、端口、令牌、启动失败）时广播 */
    changed: event<LibraryNotifyStatus>(),
  }
)
