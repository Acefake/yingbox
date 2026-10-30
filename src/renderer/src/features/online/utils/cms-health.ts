/** CMS 的列表、搜索与详情分别记录健康状态，启用选择由源管理模块持有。 */
import { asRecord } from '@/utils/json'

/** 可独立失败或恢复的接口能力。 */
export type CmsCapability = 'browse' | 'search' | 'detail'
/** 某个接口能力最近一次实际请求的结果。 */
export interface CmsHealth {
  checkedAt: number
  failures: number
  until: number
  error: string
}
/** API 地址与能力对应的健康缓存。 */
export type CmsHealthCache = Record<
  string,
  Partial<Record<CmsCapability, CmsHealth>>
>
/** 正常记录缓存时间。 */
export const CMS_HEALTH_TTL = 30 * 60_000
/** 连续三次失败后的冷却时间。 */
export const CMS_COOLDOWN = 30 * 60_000
/** 冷却之前，两次失败的后台重试间隔。 */
const RETRY_DELAYS = [60_000, 5 * 60_000]

/** 一次实际请求完成后更新健康记录；空错误表示成功。 */
export function nextHealth(
  previous: CmsHealth | undefined,
  error: string,
  now: number
): CmsHealth {
  if (!error) return { checkedAt: now, failures: 0, until: 0, error: '' }
  const failures = (previous?.failures ?? 0) + 1
  return {
    checkedAt: now,
    failures,
    until: failures >= 3 ? now + CMS_COOLDOWN : 0,
    error,
  }
}

/** 当前是否允许一次实际业务请求；没有记录和过期冷却都允许尝试。 */
export function canUse(value: CmsHealth | undefined, now: number): boolean {
  return !value || value.until <= now
}

/** 后台列表测活是否到期；手动检测由调用方显式绕过此判断。 */
export function probeDue(value: CmsHealth | undefined, now: number): boolean {
  if (!value) return true
  if (value.until) return value.until <= now
  const delay = value.failures
    ? RETRY_DELAYS[Math.min(value.failures, 2) - 1]
    : CMS_HEALTH_TTL
  return now - value.checkedAt >= delay
}

/** 读取持久化边界，只保留合法能力及数值字段，损坏缓存视为空。 */
export function parseHealthCache(text: string): CmsHealthCache {
  let input: Record<string, unknown> | undefined
  try {
    input = asRecord(JSON.parse(text))
  } catch {
    return {}
  }
  const output: Array<[string, Partial<Record<CmsCapability, CmsHealth>>]> = []
  for (const [api, raw] of Object.entries(input ?? {})) {
    const capabilities = asRecord(raw)
    const result: Partial<Record<CmsCapability, CmsHealth>> = {}
    for (const key of ['browse', 'search', 'detail'] as const) {
      const value = asRecord(capabilities?.[key])
      if (
        !value ||
        typeof value.checkedAt !== 'number' ||
        !Number.isFinite(value.checkedAt) ||
        value.checkedAt < 0 ||
        typeof value.until !== 'number' ||
        !Number.isFinite(value.until) ||
        value.until < 0 ||
        typeof value.failures !== 'number' ||
        !Number.isSafeInteger(value.failures) ||
        value.failures < 0 ||
        typeof value.error !== 'string'
      )
        continue
      if (
        (value.failures === 0 && (value.until !== 0 || value.error !== '')) ||
        (value.failures > 0 && !value.error) ||
        (value.failures < 3 && value.until !== 0)
      )
        continue
      result[key] = {
        checkedAt: value.checkedAt,
        failures: value.failures,
        until: value.until,
        error: value.error,
      }
    }
    if (Object.keys(result).length) output.push([api, result])
  }
  return Object.fromEntries(output)
}

/** 对用户显示可定位的请求错误，不持久化上游响应体或 URL 中的凭据。 */
export function cmsErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const http = message.match(/HTTP\s+\d{3}/i)
  if (http) return http[0]
  if (/timeout|超时|abort/i.test(message)) return '连接超时'
  if (/ERR_CERT|ERR_SSL|证书/i.test(message)) return 'TLS 或证书错误'
  if (/JSON/i.test(message)) return '接口返回非 JSON 数据'
  if (/ERR_CONNECTION|ECONN|ENOTFOUND/i.test(message)) return '连接失败'
  return (
    message.replace(/https?:\/\/\S+/gi, '[地址]').slice(0, 100) || '请求失败'
  )
}
