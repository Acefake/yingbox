/**
 * rexxar → frodo 回退策略：先走 m.douban.com/rexxar，失败或被风控时再走 frodo.douban.com。
 *
 * 触发回退的情况：
 * - rexxar 抛错：HTTP 403 / 418 / 5xx、超时、网络错误、熔断中、返回的不是 JSON（302 到 sec.douban.com 验证页后拿到 HTML）；
 * - rexxar 返回空结果（调用方用 isEmpty 判断；风控时常见「200 + 空列表」）。
 * 调用方自己取消（signal）时不回退，原样抛出。
 *
 * 两边都失败：rexxar 抛过错就抛 rexxar 的那个错误（调用方现有的错误形态不变）；
 * rexxar 只是空结果就返回那份空结果；冷却期内跳过了 rexxar 的，frodo 失败后再试一次 rexxar。frodo 也空时返回 frodo 的空结果（由调用方按「查无此片」缓存）。
 *
 * 每次走了 frodo 都打一行日志，写明 rexxar 为什么没用上、frodo 成没成。
 */
import { FRODO_SWITCH_ENV } from './switch'

/** 一次回退调用。 */
export interface FrodoFallback<T> {
  /** 关掉时只走 rexxar（与没有 frodo 之前完全一样） */
  enabled: boolean
  /** 日志前缀，如「豆瓣补类型」「豆瓣浏览」 */
  label: string
  rexxar: () => Promise<T>
  frodo: () => Promise<T>
  /** 结果是不是空的；空结果也回退。缺省不判空 */
  isEmpty?: (value: T) => boolean
  log?: (message: string) => void
  /** 调用方的取消信号：已取消时不回退 */
  signal?: AbortSignal
  /** rexxar 出错后的冷却：冷却期内直接走 frodo，不再先撞一次 rexxar */
  cooldown?: SourceCooldown
}

/** 把一次失败说成一句话（日志用）。 */
export function describeFailure(error: unknown): string {
  const e = error as { status?: unknown; name?: unknown; message?: unknown }
  if (typeof e?.status === 'number') return `HTTP ${e.status}`
  if (e?.name === 'SyntaxError') return '返回的不是 JSON（可能是验证页）'
  if (e?.name === 'TimeoutError') return '超时'
  const message = typeof e?.message === 'string' ? e.message : String(error)
  return message || '未知错误'
}

/**
 * rexxar 出错后的冷却期：同一个用途连续撞风控时，冷却期内不再先试 rexxar（省一次请求、少一次限速等待）。
 * 只记「出错」，空结果不算（空结果可能真的是查无此片）。
 */
export interface SourceCooldown {
  /** 是否还在冷却期 */
  active(): boolean
  /** 记一次 rexxar 出错 */
  trip(): void
  /** rexxar 成功：解除冷却 */
  reset(): void
}

/** 新建冷却期记录。 */
export function createSourceCooldown(
  ms: number,
  now: () => number = Date.now
): SourceCooldown {
  let until = 0
  return {
    active: () => now() < until,
    trip: () => {
      until = now() + ms
    },
    reset: () => {
      until = 0
    },
  }
}

/** 先 rexxar 后 frodo；规则见文件头。 */
export async function withFrodoFallback<T>(
  options: FrodoFallback<T>
): Promise<T> {
  const { label, log, signal, cooldown } = options
  if (!options.enabled) return options.rexxar()
  const isEmpty = options.isEmpty ?? (() => false)

  let reason: string
  let rexxarError: { error: unknown } | null = null
  let rexxarEmpty: { value: T } | null = null
  if (cooldown?.active()) {
    reason = '冷却中（刚被拦过）'
  } else {
    try {
      const value = await options.rexxar()
      cooldown?.reset()
      if (!isEmpty(value)) return value
      rexxarEmpty = { value }
      reason = '返回空结果'
    } catch (error) {
      if (signal?.aborted) throw error
      cooldown?.trip()
      rexxarError = { error }
      reason = `失败（${describeFailure(error)}）`
    }
  }

  try {
    const value = await options.frodo()
    const empty = isEmpty(value)
    log?.(
      `${label}：rexxar ${reason}，改走 frodo${empty ? '，也是空结果' : ''}`
    )
    // rexxar 只是空、frodo 也空：两份一样，用 frodo 的（调用方按查无此片缓存）
    return value
  } catch (error) {
    if (signal?.aborted) throw error
    log?.(
      `${label}：rexxar ${reason}，frodo 也失败（${describeFailure(error)}）；可设 ${FRODO_SWITCH_ENV}=off 关闭回退`
    )
    if (rexxarEmpty) return rexxarEmpty.value
    if (rexxarError) throw rexxarError.error
    // 冷却中直接走 frodo 又失败：再试一次 rexxar，结果与错误都按 rexxar 的原样交回
    const value = await options.rexxar()
    cooldown?.reset()
    return value
  }
}
