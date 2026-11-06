import { type NetworkPreferences, tmdbCandidates } from './preferences'

/** 仅对 TMDB GET 的网络错误和 5xx 切换备用域名；取消、鉴权与限流不切换。 */
export async function fetchTmdb<
  T extends { status: number; body?: { cancel(): Promise<unknown> } | null },
>(
  url: string,
  send: (url: string, signal?: AbortSignal) => Promise<T>,
  mode: NetworkPreferences['tmdbMode'] = 'auto',
  signal?: AbortSignal | null
): Promise<T> {
  const candidates = tmdbCandidates(url, mode)
  for (let i = 0; i < candidates.length; i++) {
    signal?.throwIfAborted()
    let response: T
    try {
      const attempt = AbortSignal.timeout(6000)
      response = await send(
        candidates[i],
        signal ? AbortSignal.any([signal, attempt]) : attempt
      )
    } catch (error) {
      if (signal?.aborted || i === candidates.length - 1) throw error
      continue
    }
    if (response.status < 500 || i === candidates.length - 1) return response
    await response.body?.cancel().catch(() => {})
  }
  throw new Error('没有可用的 TMDB 端点')
}
