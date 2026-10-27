/**
 * PanSou 分享有效性检测：POST {base}/api/check/links（fish2018/pansou README「链接检测API」）。
 *
 * 请求体 { items: [{ disk_type: '115', url, password? }] }，响应 { results: [{ url, state, … }] }，
 * state 取 ok / bad / locked / unsupported / uncertain；这里只认前三种，其余记作 unknown。
 * 公共实例的搜索接口包一层 { code, data }，检测接口也兼容这层外壳。
 *
 * 检测只是锦上添花，绝不影响搜索与转存：
 * - 单次只等 {@link CHECK_TIMEOUT_MS}，不重试（与搜索的超时重试分开）；
 * - 超时、连不上、非 2xx、格式不认识都返回空结果（各条按 unknown 处理），不抛错；
 * - 实例没有这个接口（404 / 405）时按地址记住，本次运行里不再请求它。
 * 出网范围与搜索相同：用户填的地址，重定向只跟同一主机（http.ts 的 sameHostFetch）。
 */
import type {
  LinkCheckItem,
  LinkCheckReply,
  LinkCheckState,
} from '../../shared/contract/pan115'
import { type FetchLike, fetchResponse, obj, sameHostFetch, text } from './http'
import { panSouEndpoint } from './pansou'
import { parseShareLink } from './share-link'

/** 单次检测请求的等待上限（毫秒）；超时不重试 */
export const CHECK_TIMEOUT_MS = 8_000

/** 说明实例没有检测接口的状态码 */
const UNSUPPORTED_STATUS = new Set([404, 405])

const STATES: ReadonlySet<string> = new Set(['ok', 'bad', 'locked'])

/** 设置里的 PanSou 地址 → 检测接口地址；不是 http(s) 时抛错（与搜索同一套校验） */
export function checkEndpoint(base: string): string {
  return panSouEndpoint(base).replace(/\/api\/search$/, '/api/check/links')
}

/** 请求体：只送 115 分享，提取码有就带上 */
export function checkRequestBody(items: LinkCheckItem[]): string {
  return JSON.stringify({
    items: items.map(item => ({
      disk_type: '115',
      url: item.url,
      ...(item.password ? { password: item.password } : {}),
    })),
  })
}

/** PanSou 的 state → 三种可显示状态，其余（unsupported / uncertain / 缺省）为 unknown */
export function stateOf(value: unknown): LinkCheckState {
  const state = text(value)
  return STATES.has(state) ? (state as LinkCheckState) : 'unknown'
}

/**
 * 解析检测响应，按请求的链接一一对应：结果里的 url 是原样传入的链接；
 * 缺 url 的结果按下标对应（PanSou 按请求顺序返回）。没对上的条目不出现在结果里。
 */
export function parseCheckResponse(
  json: unknown,
  items: LinkCheckItem[]
): { url: string; state: LinkCheckState }[] {
  const root = obj(json)
  const list = root.results ?? obj(root.data).results
  if (!Array.isArray(list)) return []
  const wanted = new Set(items.map(item => item.url))
  const out = new Map<string, LinkCheckState>()
  list.forEach((raw, index) => {
    const entry = obj(raw)
    const url = text(entry.url) || items[index]?.url
    if (url && wanted.has(url) && !out.has(url))
      out.set(url, stateOf(entry.state))
  })
  return [...out].map(([url, state]) => ({ url, state }))
}

/** 检测器：记住哪些 PanSou 地址没有检测接口 */
export interface LinkChecker {
  checkLinks(items: LinkCheckItem[]): Promise<LinkCheckReply>
}

/**
 * 创建检测器。
 * @param fetch 局域网地址用的 fetch（与搜索相同）
 * @param pansouUrl 当前设置里的 PanSou 地址（空串 = 未填）
 * @param timeoutMs 单次超时（测试用小值）
 */
export function createLinkChecker(
  fetch: FetchLike,
  pansouUrl: () => string,
  timeoutMs = CHECK_TIMEOUT_MS
): LinkChecker {
  const unsupported = new Set<string>()
  const guarded = sameHostFetch(fetch, 'PanSou')

  return {
    async checkLinks(items) {
      const base = pansouUrl().trim()
      if (!base || unsupported.has(base)) return { supported: false }
      let url: string
      try {
        url = checkEndpoint(base)
      } catch {
        return { supported: false }
      }
      const shares = items.filter(item => parseShareLink(item.url))
      if (!shares.length) return { supported: true, results: [] }
      try {
        const response = await fetchResponse(
          guarded,
          'PanSou',
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: checkRequestBody(shares),
          },
          timeoutMs
        )
        if (UNSUPPORTED_STATUS.has(response.status)) {
          unsupported.add(base)
          return { supported: false }
        }
        if (!response.ok) return { supported: true, results: [] }
        return {
          supported: true,
          results: parseCheckResponse(await response.json(), shares),
        }
      } catch {
        return { supported: true, results: [] }
      }
    },
  }
}
