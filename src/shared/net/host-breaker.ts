/**
 * 按主机熔断：被硬封锁或连续失败的主机在冷却期内直接判失败，不再发请求、不再弹验证窗口。
 * 引擎（插件 $fetch）与主进程（浏览器代抓）各持一份，规则相同。
 */

/** 熔断原因：硬封锁、验证没通过、连不上、插件脚本下载失败。 */
export type TripReason = 'blocked' | 'challenge' | 'unreachable' | 'plugin'

/** 一次熔断：哪个主机、为什么、到什么时候（毫秒时间戳）。 */
export interface HostTrip {
  host: string
  reason: TripReason
  until: number
}

/** 熔断器选项。 */
export interface HostBreakerOptions {
  /** 冷却时长，默认 30 分钟 */
  cooldownMs?: number
  /** 连续失败多少次熔断，默认 3 */
  threshold?: number
  now?: () => number
}

/** 熔断器。所有方法接受完整 URL 或主机名。 */
export interface HostBreaker {
  /** 主机是否在冷却期；是则返回熔断信息 */
  check(target: string): HostTrip | null
  /** 硬封锁：立即熔断 */
  block(target: string): HostTrip
  /** 记一次失败；达到阈值时熔断并返回熔断信息 */
  fail(target: string, reason?: TripReason): HostTrip | null
  /** 成功：清零失败计数 */
  succeed(target: string): void
  /** 解除熔断：给主机只清这一个，不给清全部 */
  reset(target?: string): void
}

/** 默认冷却：30 分钟 */
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000
/** 默认连续失败阈值 */
export const DEFAULT_THRESHOLD = 3

/** 熔断时抛出的错误，带上熔断信息供调用方回报。 */
export class HostUnavailableError extends Error {
  constructor(readonly trip: HostTrip) {
    super(`${trip.host} 暂不可用（${tripLabel(trip.reason)}）`)
    this.name = 'HostUnavailableError'
  }
}

/** 熔断原因的简短中文说明。 */
export function tripLabel(reason: TripReason): string {
  if (reason === 'blocked') return '被站点拦截'
  if (reason === 'challenge') return '站点验证未通过'
  if (reason === 'plugin') return '插件脚本下载失败'
  return '无法访问'
}

/** 取主机名（小写）；传入的不是 URL 时按主机名原样处理。 */
export function hostOf(target: string): string {
  try {
    return new URL(target).hostname.toLowerCase()
  } catch {
    return target.trim().toLowerCase()
  }
}

/** 创建熔断器。 */
export function createHostBreaker(
  options: HostBreakerOptions = {}
): HostBreaker {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const threshold = Math.max(1, options.threshold ?? DEFAULT_THRESHOLD)
  const now = options.now ?? Date.now
  const trips = new Map<string, HostTrip>()
  const failures = new Map<string, number>()

  const open = (host: string, reason: TripReason): HostTrip => {
    const trip = { host, reason, until: now() + cooldownMs }
    trips.set(host, trip)
    failures.delete(host)
    return trip
  }

  return {
    check(target) {
      const host = hostOf(target)
      const trip = trips.get(host)
      if (!trip) return null
      if (trip.until > now()) return trip
      trips.delete(host)
      return null
    },
    block: target => open(hostOf(target), 'blocked'),
    fail(target, reason = 'unreachable') {
      const host = hostOf(target)
      const count = (failures.get(host) ?? 0) + 1
      if (count >= threshold) return open(host, reason)
      failures.set(host, count)
      return null
    },
    succeed(target) {
      failures.delete(hostOf(target))
    },
    reset(target) {
      if (target === undefined) {
        trips.clear()
        failures.clear()
        return
      }
      const host = hostOf(target)
      trips.delete(host)
      failures.delete(host)
    },
  }
}
