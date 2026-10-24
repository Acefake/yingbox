/**
 * 板块密码锁的跨进程数据：主进程保存应用密码的 scrypt 哈希与锁的配置（锁哪些板块、多久重新锁定），
 * 做系统认证并签发一次性验证凭据；渲染层据此拦路由、决定什么时候要重新解锁。
 * 降低保护的配置变更（取消锁定、放宽重新锁定）必须带凭据，主进程写入时校验。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

/** 应用密码长度范围（按字符计） */
export const LOCK_PASSWORD_MIN = 4
export const LOCK_PASSWORD_MAX = 128

/** 可用的系统认证：macOS Touch ID；其他平台没有可调用的系统认证时为 null */
export type SystemAuth = 'touchid' | null

/** 最多锁多少个板块；重新锁定时间上限（分钟） */
export const LOCK_SECTIONS_MAX = 32
export const RELOCK_MINUTES_MAX = 1440

/** 锁的配置（主进程保存） */
export interface LockConfig {
  /** 进入时要解锁的板块（路由名）；没设应用密码时不生效 */
  sections: string[]
  /** 解锁后离开板块（或窗口隐藏）多少分钟重新锁定；0 = 本次运行内一直有效 */
  relockMinutes: number
}

/** 默认配置：不锁任何板块 */
export const DEFAULT_LOCK_CONFIG: Readonly<LockConfig> = {
  sections: [],
  relockMinutes: 0,
}

/** 锁的现状 */
export interface SectionLockStatus extends LockConfig {
  /** 已设置应用密码 */
  passwordSet: boolean
  /** 可用的系统认证 */
  systemAuth: SystemAuth
}

/** 一次验证（密码或系统认证）的结果 */
export interface LockVerifyResult {
  ok: boolean
  /** 连续输错被暂时拒绝时，还要等多少毫秒（否则为 0） */
  retryAfterMs: number
  /** 通过时签发的一次性凭据（短时有效），降低保护的写入要带上；不通过为空串 */
  grant: string
}

/** 解析锁的配置；板块名须是路由名（去重），重新锁定 0–1440 分钟整数；不合法返回 undefined */
export function parseLockConfig(raw: unknown): LockConfig | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const { sections, relockMinutes } = raw as Partial<Record<string, unknown>>
  if (!Array.isArray(sections) || sections.length > LOCK_SECTIONS_MAX)
    return undefined
  const valid = sections.every(
    item => typeof item === 'string' && /^[A-Za-z][\w-]{0,63}$/.test(item)
  )
  if (!valid) return undefined
  if (
    !Number.isSafeInteger(relockMinutes) ||
    (relockMinutes as number) < 0 ||
    (relockMinutes as number) > RELOCK_MINUTES_MAX
  )
    return undefined
  return {
    sections: [...new Set(sections as string[])],
    relockMinutes: relockMinutes as number,
  }
}

/**
 * 配置从 prev 变为 next 是否降低保护：prev 里锁定的板块在 next 里不再锁定，
 * 或重新锁定放宽（prev 会自动锁定，next 不自动锁定或时限更长）。只增加锁定、收紧时限不算。
 */
export function weakensLock(prev: LockConfig, next: LockConfig): boolean {
  if (prev.sections.some(name => !next.sections.includes(name))) return true
  if (prev.relockMinutes === 0) return false
  return next.relockMinutes === 0 || next.relockMinutes > prev.relockMinutes
}

/** 新密码是否合法（长度、不含换行与空字符）；合法返回原值，否则 undefined */
export function parseLockPassword(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const length = [...raw].length
  if (length < LOCK_PASSWORD_MIN || length > LOCK_PASSWORD_MAX) return undefined
  return /[\0\r\n]/.test(raw) ? undefined : raw
}
