/**
 * 按候选 URL 顺序请求，可重试失败时换下一个（ADR-0046 / ADR-0055）。
 * 每次尝试使用独立 timeoutMs，避免官方超时后 signal 已 abort 导致镜像无法请求。
 */
import { shouldTryNextMirror } from './mirrors'

export type FetchFirstInit = RequestInit & {
  /** 每个候选独立超时（毫秒）；设置后忽略 init.signal */
  timeoutMs?: number
}

/** 依次尝试 urls，返回第一个 ok 的 Response */
export async function fetchFirstOk(
  urls: readonly string[],
  fetchImpl: typeof fetch,
  init?: FetchFirstInit
): Promise<Response> {
  if (urls.length === 0) throw new Error('没有可用的更新地址')
  const timeoutMs = init?.timeoutMs
  const rest = { ...(init ?? {}) }
  delete rest.timeoutMs
  if (timeoutMs != null) delete rest.signal
  let lastError: unknown = new Error('没有可用的更新地址')
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index]
    const viaMirror = index > 0
    const signal =
      timeoutMs != null ? AbortSignal.timeout(timeoutMs) : rest.signal
    let response: Response
    try {
      response = await fetchImpl(url, { ...rest, signal })
    } catch (error) {
      lastError = error
      if (!shouldTryNextMirror(null, error, viaMirror)) throw error
      continue
    }
    if (response.ok) return response
    await response.body?.cancel().catch(() => {})
    lastError = new Error(`检查更新失败：HTTP ${response.status}`)
    if (!shouldTryNextMirror(response.status, null, viaMirror)) throw lastError
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
