/**
 * 渲染层访问在线域的唯一入口。请求全部在后台引擎经 net 出网（SSRF 防护、超时、大小上限）。
 * Web / PWA 模式没有引擎，调用时抛出可读错误。
 */
import type { GetJsonOptions } from '../../../../../shared/contract/online'

/** 在线域 API；Web 模式下抛错。 */
export function onlineApi(): Window['api']['online'] {
  const api = typeof window !== 'undefined' ? window.api?.online : undefined
  if (!api) throw new Error('在线功能需要桌面端')
  return api
}

/** GET 一个 JSON 接口。 */
export function getJson<T = unknown>(
  url: string,
  options?: GetJsonOptions
): Promise<T> {
  return onlineApi().getJson(url, options) as Promise<T>
}

/** 拼接查询串。 */
export function withQuery(
  url: string,
  query: Record<string, string | number>
): string {
  const target = new URL(url)
  for (const [key, value] of Object.entries(query))
    target.searchParams.set(key, String(value))
  return String(target)
}
