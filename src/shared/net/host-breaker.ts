/**
 * 按主机熔断：被硬封锁或连续失败的主机在冷却期内直接判失败，不再发请求、不再弹验证窗口。
 * 引擎（插件 $fetch）与主进程（浏览器代抓）各持一份，规则相同。
 *
 * 在线插件源按「主机 + 路径类别」分开熔断（传 scopeOf: pathScope）：同一站点的搜索被封
 * （如 4k-av 的 /s?q=）不连带分类、详情、播放。番号刮削仍只按主机。
 */

/** 熔断原因：硬封锁、验证没通过、连不上、插件脚本下载失败。 */
export type TripReason = 'blocked' | 'challenge' | 'unreachable' | 'plugin'

/** 路径类别：搜索，或其余（分类 / 详情 / 播放）。 */
export type HostScope = 'search' | 'browse'

/** 一次熔断：哪个主机、为什么、到什么时候（毫秒时间戳）；分类熔断时带上路径类别。 */
export interface HostTrip {
  host: string
  reason: TripReason
  until: number
  scope?: HostScope
}

/** 熔断器选项。 */
export interface HostBreakerOptions {
  /** 冷却时长，默认 30 分钟 */
  cooldownMs?: number
  /** 连续失败多少次熔断，默认 3 */
  threshold?: number
  now?: () => number
  /** 按路径类别分开熔断；缺省只按主机 */
  scopeOf?: (target: string) => HostScope
  /** 启动时恢复的熔断（过期的自动丢弃） */
  restore?: readonly HostTrip[]
  /** 熔断表变化（新熔断、解除、到期清理）时回调当前未过期的熔断，供持久化 */
  onChange?: (trips: HostTrip[]) => void
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
  /** 解除熔断：给主机只清这个主机（所有类别），不给清全部 */
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

const SEARCH_PATH = /search/i
const SEARCH_SEGMENT = /^s(?:-|$)/i
const SEARCH_PARAMS = ['s', 'q', 'wd', 'query', 'keyword', 'searchValue']

/**
 * 按插件的实际地址判断是不是搜索请求：路径或查询里带 search（/search/x、/vodsearch/、
 * briefsearch、?m=vod-search），路径段是 s（/s?q=、/s----.html），或带常见搜索参数（?s= ?wd=）。
 * 不是 URL 的一律算 browse。
 */
export function pathScope(target: string): HostScope {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'browse'
  }
  const searchy =
    SEARCH_PATH.test(url.pathname) ||
    SEARCH_PATH.test(url.search) ||
    url.pathname.split('/').some(seg => SEARCH_SEGMENT.test(seg)) ||
    SEARCH_PARAMS.some(key => url.searchParams.has(key))
  return searchy ? 'search' : 'browse'
}

/** 创建熔断器。 */
export function createHostBreaker(
  options: HostBreakerOptions = {}
): HostBreaker {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const threshold = Math.max(1, options.threshold ?? DEFAULT_THRESHOLD)
  const now = options.now ?? Date.now
  const { scopeOf, onChange } = options
  /** 熔断表键：主机，或「主机 类别」 */
  const trips = new Map<string, HostTrip>()
  const failures = new Map<string, number>()
  const keyOf = (
    target: string
  ): { key: string; host: string; scope?: HostScope } => {
    const host = hostOf(target)
    const scope = scopeOf?.(target)
    return { key: scope ? `${host} ${scope}` : host, host, scope }
  }
  const changed = (): void => onChange?.([...trips.values()])

  for (const trip of options.restore ?? [])
    if (trip.until > now())
      trips.set(trip.scope ? `${trip.host} ${trip.scope}` : trip.host, trip)

  const open = (target: string, reason: TripReason): HostTrip => {
    const { key, host, scope } = keyOf(target)
    const trip: HostTrip = { host, reason, until: now() + cooldownMs }
    if (scope) trip.scope = scope
    trips.set(key, trip)
    failures.delete(key)
    changed()
    return trip
  }

  return {
    check(target) {
      // 分类别时也认不带类别的整站熔断（恢复的旧记录等）
      const { key, host } = keyOf(target)
      for (const k of key === host ? [key] : [key, host]) {
        const trip = trips.get(k)
        if (!trip) continue
        if (trip.until > now()) return trip
        trips.delete(k)
        changed()
      }
      return null
    },
    block: target => open(target, 'blocked'),
    fail(target, reason = 'unreachable') {
      const { key } = keyOf(target)
      const count = (failures.get(key) ?? 0) + 1
      if (count >= threshold) return open(target, reason)
      failures.set(key, count)
      return null
    },
    succeed(target) {
      failures.delete(keyOf(target).key)
    },
    reset(target) {
      if (target === undefined) {
        trips.clear()
        failures.clear()
      } else {
        const host = hostOf(target)
        const mine = (key: string): boolean =>
          key === host || key.startsWith(`${host} `)
        for (const key of [...trips.keys()]) if (mine(key)) trips.delete(key)
        for (const key of [...failures.keys()])
          if (mine(key)) failures.delete(key)
      }
      changed()
    },
  }
}
