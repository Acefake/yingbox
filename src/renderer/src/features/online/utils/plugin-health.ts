/**
 * 插件源可用性的纯规则：熔断是否还在生效、给用户看的说明、搜索时跳过哪些源。
 * 状态本身（哪个源何时不可用）在 ../composables/plugin-health。
 */
import type {
  HostTrip,
  TripReason,
} from '../../../../../shared/contract/online'

/** 一个插件源的不可用记录（来自引擎回报的熔断）。 */
export type PluginHealth = HostTrip

const REASON_TEXT: Record<TripReason, string> = {
  blocked: '被站点拦截',
  challenge: '站点验证未通过',
  unreachable: '无法访问',
  plugin: '插件脚本下载失败',
}

/** 记录是否仍在冷却期。 */
export const isActive = (
  health: PluginHealth | undefined,
  now: number
): health is PluginHealth => !!health && health.until > now

/** 列表里的一行说明，例如「被站点拦截 · 约 30 分钟后自动重试」。 */
export function healthNote(health: PluginHealth, now: number): string {
  const minutes = Math.max(1, Math.ceil((health.until - now) / 60_000))
  return `${REASON_TEXT[health.reason]} · 约 ${minutes} 分钟后自动重试`
}

/** 给搜索用：拆成要请求的源与跳过的源（冷却期内的源不再请求）。 */
export function splitByHealth<T extends { name: string }>(
  sites: readonly T[],
  healthOf: (name: string) => PluginHealth | undefined,
  now: number
): { usable: T[]; skipped: T[] } {
  const usable: T[] = []
  const skipped: T[] = []
  for (const site of sites)
    (isActive(healthOf(site.name), now) ? skipped : usable).push(site)
  return { usable, skipped }
}
