import { call, defineDomain, event } from './define'

/** 观看进度同步的状态。 */
export interface ProgressSyncStatus {
  /** 填了片库服务地址（令牌可选） */
  configured: boolean
  /** 正在同步 */
  syncing: boolean
  /** 上一次成功同步的时间（毫秒）；从没成功为 null */
  lastSyncAt: number | null
  /** 上一次失败的原因；成功后清空 */
  error: string | null
  /** 上一次从服务端拉下来写进本地的条数 */
  pulled: number
  /** 上一次推给服务端、服务端收下的条数 */
  pushed: number
}

/** 片库服务回 401（设了访问令牌而桌面端没填或填错）时的错误文案；设置页据此展开令牌输入。 */
export const PROGRESS_SYNC_TOKEN_ERROR =
  '片库服务需要访问令牌：在下方填写它的 YINGBOX_SERVER_TOKEN'

/** 一次同步写进本地的条目（渲染层据此刷新进度缓存）。 */
export interface ProgressSyncApplied {
  itemIds: number[]
}

/**
 * 观看进度同步（桌面端 ↔ 片库服务）：主进程按设置 library.progressServer 与可选密钥 progressServerToken
 * 定时双向合并（见 src/main/library/progress-sync）。地址和令牌是普通设置 / 密钥，这里只给状态与「立即同步」。
 */
export const progressSync = defineDomain(
  'progressSync',
  {
    status: call<ProgressSyncStatus>(),
    /** 立即同步一次，返回同步后的状态 */
    syncNow: call<ProgressSyncStatus>(),
  },
  {
    /** 状态变化时广播 */
    changed: event<ProgressSyncStatus>(),
    /** 从服务端拉下的进度写进了本地 */
    applied: event<ProgressSyncApplied>(),
  }
)
