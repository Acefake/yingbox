/**
 * 板块密码锁的跨进程数据：主进程保存应用密码的 scrypt 哈希、做系统认证，
 * 渲染层决定哪些板块要锁、什么时候要重新解锁。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

/** 应用密码长度范围（按字符计） */
export const LOCK_PASSWORD_MIN = 4
export const LOCK_PASSWORD_MAX = 128

/** 可用的系统认证：macOS Touch ID；其他平台没有可调用的系统认证时为 null */
export type SystemAuth = 'touchid' | null

/** 锁的现状 */
export interface SectionLockStatus {
  /** 已设置应用密码 */
  passwordSet: boolean
  /** 可用的系统认证 */
  systemAuth: SystemAuth
}

/** 一次密码校验的结果 */
export interface LockVerifyResult {
  ok: boolean
  /** 连续输错被暂时拒绝时，还要等多少毫秒（否则为 0） */
  retryAfterMs: number
}

/** 新密码是否合法（长度、不含换行与空字符）；合法返回原值，否则 undefined */
export function parseLockPassword(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const length = [...raw].length
  if (length < LOCK_PASSWORD_MIN || length > LOCK_PASSWORD_MAX) return undefined
  return /[\0\r\n]/.test(raw) ? undefined : raw
}
