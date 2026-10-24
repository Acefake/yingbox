/**
 * 板块密码锁的主进程纯规则：连续输错的限流、一次性验证凭据。
 */

/** 连续输错多少次后暂停 */
export const MAX_FAILURES = 5
/** 暂停多久（毫秒）；之后每再错满一轮翻倍，最长 15 分钟 */
export const LOCKOUT_MS = 30_000
export const MAX_LOCKOUT_MS = 15 * 60_000

/** 输错限流器：check 返回还要等多少毫秒（0 = 可以尝试），record 记录一次结果 */
export interface AttemptLimiter {
  check(): number
  record(ok: boolean): void
}

export function createAttemptLimiter(
  now: () => number = Date.now
): AttemptLimiter {
  let failures = 0
  let rounds = 0
  let blockedUntil = 0
  return {
    check: () => Math.max(0, blockedUntil - now()),
    record: ok => {
      if (ok) {
        failures = 0
        rounds = 0
        blockedUntil = 0
        return
      }
      failures += 1
      if (failures < MAX_FAILURES) return
      failures = 0
      blockedUntil = now() + Math.min(LOCKOUT_MS * 2 ** rounds, MAX_LOCKOUT_MS)
      rounds += 1
    },
  }
}

/** 一次性验证凭据的有效期：验证通过后这么久内要用掉 */
export const GRANT_TTL_MS = 60_000

/** 一次性验证凭据：issue 在验证通过后签发，consume 校验并作废（过期、用过、伪造都不通过） */
export interface GrantStore {
  issue(): string
  consume(grant: string): boolean
}

export function createGrantStore(
  token: () => string,
  now: () => number = Date.now
): GrantStore {
  const grants = new Map<string, number>()
  const prune = (): void => {
    const time = now()
    for (const [grant, expiresAt] of grants)
      if (expiresAt <= time) grants.delete(grant)
  }
  return {
    issue: () => {
      prune()
      const grant = token()
      grants.set(grant, now() + GRANT_TTL_MS)
      return grant
    },
    consume: grant => {
      prune()
      if (!grant || !grants.has(grant)) return false
      grants.delete(grant)
      return true
    },
  }
}
