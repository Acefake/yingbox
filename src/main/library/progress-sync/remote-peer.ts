/**
 * 片库服务这一端：经它的 HTTP RPC（POST /api/library/rpc；服务设了访问令牌时带 Bearer）调 progress.export / import。
 *
 * 服务端地址是用户自己填的（多半是局域网 NAS），所以不走私网拦截；但只认 http / https、
 * 不带账号密码，不跟随重定向，每次请求 15 秒超时。返回体在这里逐字段校验（系统边界）。
 */
import { PROGRESS_SYNC_TOKEN_ERROR } from '../../../shared/contract/progress-sync'
import {
  LIBRARY_HTTP,
  type ProgressImportResult,
  type ProgressSyncEntry,
} from '../../../shared/library/ipc'
import { parseSyncEntry } from '../../../shared/library/watch-progress'
import type { ProgressPeer } from './syncer'

/** 单次请求超时。 */
const TIMEOUT_MS = 15_000

/** 服务端地址规整：只认 http(s)、不带账号密码；去掉结尾斜杠。不合法返回 null。 */
export function parseServerUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** fetch 的子集（测试替换）。 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** 解析 InvokeResult：ok 时返回 result，否则抛出服务端给的原因。 */
function unwrap(body: unknown): unknown {
  if (!body || typeof body !== 'object') throw new Error('片库服务返回格式不对')
  const r = body as { ok?: unknown; result?: unknown; error?: unknown }
  if (r.ok === true) return r.result
  const message =
    r.error && typeof r.error === 'object'
      ? String((r.error as { message?: unknown }).message ?? '')
      : ''
  throw new Error(message || '片库服务返回失败')
}

function parseImportResult(raw: unknown): ProgressImportResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const count = (v: unknown): number =>
    Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0
  return {
    applied: count(r.applied),
    unmatched: count(r.unmatched),
    // 服务端的条目 id 对本地没有意义
    itemIds: [],
  }
}

/** 建服务端那一端。 */
export function createRemotePeer(options: {
  server: string
  /** 访问令牌；空串时不带 Authorization（服务默认不鉴权） */
  token: string
  fetch?: FetchLike
}): ProgressPeer {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    let response: Response
    try {
      response = await doFetch(`${options.server}${LIBRARY_HTTP.rpc}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.token
            ? { authorization: `Bearer ${options.token}` }
            : {}),
        },
        body: JSON.stringify({ method, params }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new Error(
        `连不上片库服务：${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (response.status === 401) throw new Error(PROGRESS_SYNC_TOKEN_ERROR)
    if (!response.ok) throw new Error(`片库服务返回 HTTP ${response.status}`)
    return unwrap(await response.json())
  }
  return {
    async export(since) {
      const result = await rpc('progress.export', { since })
      if (!Array.isArray(result)) throw new Error('片库服务返回格式不对')
      return result
        .map(parseSyncEntry)
        .filter((e): e is ProgressSyncEntry => e !== null)
    },
    async import(entries, preferIncoming) {
      return parseImportResult(
        await rpc('progress.import', { entries, preferIncoming })
      )
    },
  }
}
