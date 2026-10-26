/**
 * frodo 请求构造：只拼「地址 + 请求头」，不自己发请求。
 *
 * 出网由调用方注入的传输层完成，这样 frodo 与 rexxar 走同一个限速器、同一份缓存：
 * - 媒体库补类型：ProviderHttp（低速令牌桶 + provider_cache 表），见 main/library/providers/douban；
 * - 在线 / 库外发现的豆瓣浏览：shared/net 的 NetClient（SSRF 防护）+ 浏览自己的页缓存与熔断，见 engine/online。
 *
 * frodo 与 m.douban.com/rexxar 是同一套接口（rexxar 是它的网页代理）：路径、参数、返回结构一致，
 * 所以回退时直接把 rexxar 地址换成 frodo 地址再签名即可（{@link rexxarToFrodo}）。
 */
import {
  FRODO_API_KEY,
  FRODO_BASE,
  FRODO_USER_AGENT,
  frodoSignature,
  frodoTimestamp,
} from './sign'

/** 一次待发的 frodo 请求。 */
export interface FrodoRequest {
  url: string
  headers: Record<string, string>
}

/** rexxar 接口根（m.douban.com 上的网页代理）。 */
const REXXAR_PREFIX = '/rexxar/api/v2'
/** frodo 接口根。 */
const FRODO_PREFIX = '/api/v2'

/** 发 frodo 请求用的请求头（只要 Android UA；不要 Referer / Cookie）。 */
export const FRODO_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': FRODO_USER_AGENT,
}

/**
 * 拼一次签名过的 GET。
 * @param path `/api/v2` 之后的接口路径，如 `/search/movie`、`/movie/3742360`
 * @param params 业务参数（apikey / _ts / _sig 由这里追加，同名的会被覆盖）
 * @param nowMs 当前时间（毫秒），测试可固定
 */
export function frodoRequest(
  path: string,
  params: Record<string, string> | URLSearchParams,
  nowMs: number
): FrodoRequest {
  const full = `${FRODO_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
  const ts = frodoTimestamp(nowMs)
  const search = new URLSearchParams(params)
  search.set('apikey', FRODO_API_KEY)
  search.set('_ts', ts)
  search.set('_sig', frodoSignature(full, ts))
  return {
    url: `${FRODO_BASE}${full}?${search}`,
    headers: { ...FRODO_HEADERS },
  }
}

/**
 * rexxar 地址 → 等价的 frodo 请求（同路径、同参数，加签名）。
 * 不是 m.douban.com/rexxar/api/v2 下的地址返回 null（调用方据此不回退）。
 */
export function rexxarToFrodo(
  rexxarUrl: string,
  nowMs: number
): FrodoRequest | null {
  let url: URL
  try {
    url = new URL(rexxarUrl)
  } catch {
    return null
  }
  if (url.hostname !== 'm.douban.com') return null
  if (!url.pathname.startsWith(`${REXXAR_PREFIX}/`)) return null
  return frodoRequest(
    url.pathname.slice(REXXAR_PREFIX.length),
    url.searchParams,
    nowMs
  )
}
