/**
 * AI 相关的显示文案（纯函数，便于测试）。
 */
import type { AiMonthUsage } from './types'

/** tokens 数量：万以下原样（千分位），万以上「约 N 万」，亿以上「约 N 亿」 */
export function formatTokens(count: number): string {
  if (count < 10_000) return count.toLocaleString('en-US')
  if (count < 100_000_000) return `约 ${trim(count / 10_000)} 万`
  return `约 ${trim(count / 100_000_000)} 亿`
}

const trim = (value: number): string =>
  value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)

/** 设置页的本月用量一行 */
export function formatMonthUsage(usage: AiMonthUsage): string {
  if (usage.requests === 0) return '本月还没有调用'
  const tokens =
    usage.totalTokens > 0
      ? `${formatTokens(usage.totalTokens)} tokens`
      : '服务商未返回 tokens'
  return `${tokens} · ${usage.requests} 次请求`
}
