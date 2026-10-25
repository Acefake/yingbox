/**
 * 115 / PanSou 请求的公共部分：注入的 fetch 类型、请求头、读 JSON。
 */
import { Pan115Error } from './errors'

/** 注入的 fetch（主进程用 Electron net.fetch，测试用假实现） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 115 网页端常见的桌面 Chrome UA */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** 单次请求超时（毫秒）；PanSou 聚合多个来源，给得宽一些 */
export const REQUEST_TIMEOUT_MS = 30_000

/** 发请求并读 JSON；HTTP 失败、超时、非 JSON 都转成 {@link Pan115Error} */
export async function fetchJson(
  fetch: FetchLike,
  label: string,
  url: string,
  init: RequestInit = {}
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timeout = (error as Error).name === 'TimeoutError'
    if (timeout) throw new Pan115Error(`${label} 请求超时`, undefined, true)
    throw new Pan115Error(`${label} 连不上`)
  }
  if (!response.ok)
    throw new Pan115Error(`${label} 返回 HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Pan115Error(`${label} 返回的不是 JSON`)
  }
}

/** 普通对象（否则为空对象），读未知 JSON 用 */
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 字符串或数字 → 字符串；其余为空串 */
export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}
