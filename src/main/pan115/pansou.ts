/**
 * PanSou（github.com/fish2018/pansou）聚合网盘搜索：POST {base}/api/search，只要 115、merge 结果。
 * 公共实例在外面包一层 { code, message, data }，自部署的 README 格式没有，两种都认。
 *
 * 出网范围：地址由用户在设置里填（可能是局域网 NAS），所以不做私网拦截；但重定向手动处理，
 * 只跟到同一主机，跨主机（如指向 169.254.169.254 或别的内网服务）一律拦截，请求只会到用户填的那台机器。
 * 结果最多 {@link MAX_RESULTS} 条、按分享去重，标题 / 来源截断长度，大响应不会拖垮主进程与列表。
 */
import type { NetdiskItem } from '../../shared/contract/pan115'
import { Pan115Error } from './errors'
import { type FetchLike, fetchJson, obj, text } from './http'
import { parseShareLink } from './share-link'

/** 一次搜索最多返回的条数 */
export const MAX_RESULTS = 200
const MAX_TITLE = 200
const MAX_SOURCE = 80
const MAX_REDIRECTS = 3
const REDIRECTS = new Set([301, 302, 303, 307, 308])

/** 设置里的 PanSou 地址 → 搜索接口地址；不是 http(s) 时抛错 */
export function panSouEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed))
    throw new Pan115Error('PanSou 地址应以 http:// 或 https:// 开头')
  return `${trimmed}/api/search`
}

/** 解析搜索响应：只留能解析出分享码的 115 链接 */
export function parsePanSouResponse(json: unknown): NetdiskItem[] {
  const root = obj(json)
  if (!Object.keys(root).length) throw new Pan115Error('PanSou 返回格式不认识')
  if (typeof root.code === 'number' && root.code !== 0)
    throw new Pan115Error(
      text(root.message) || `PanSou 返回错误（${root.code}）`
    )
  const merged = obj(obj('data' in root ? root.data : root).merged_by_type)
  const list = Array.isArray(merged['115']) ? merged['115'] : []
  const items: NetdiskItem[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (items.length >= MAX_RESULTS) break
    const entry = obj(raw)
    const url = text(entry.url)
    const ref = parseShareLink(url, text(entry.password))
    if (!ref) continue
    const key = `${ref.shareCode}/${ref.receiveCode}`
    if (seen.has(key)) continue
    seen.add(key)
    const datetime = text(entry.datetime)
    items.push({
      title: (text(entry.note) || ref.shareCode).slice(0, MAX_TITLE),
      source: text(entry.source).slice(0, MAX_SOURCE),
      // Go 的零值时间（0001-01-01）表示来源没给
      datetime:
        datetime && !datetime.startsWith('0001-') ? datetime : undefined,
      url,
      ...ref,
    })
  }
  return items
}

/**
 * 包一层 fetch：重定向手动跟随，只允许同一主机（http → https 升级也算），最多 3 跳；
 * 307 / 308 保留方法与请求体，其余改成 GET。跨主机时抛错。
 */
export function sameHostFetch(fetch: FetchLike): FetchLike {
  return async (url, init = {}) => {
    let current = url
    let request: RequestInit = { ...init, redirect: 'manual' }
    for (let hop = 0; ; hop++) {
      const response = await fetch(current, request)
      const location = response.headers.get('location')
      if (!REDIRECTS.has(response.status) || !location) return response
      const next = new URL(location, current)
      if (next.hostname !== new URL(current).hostname)
        throw new Pan115Error(
          `PanSou 重定向到别的主机（${next.hostname}），已拦截`
        )
      if (hop >= MAX_REDIRECTS) throw new Pan115Error('PanSou 重定向次数过多')
      if (response.status !== 307 && response.status !== 308) {
        request = { ...request, method: 'GET', body: undefined }
      }
      current = next.toString()
    }
  }
}

/** 搜一个关键词 */
export async function searchPanSou(
  fetch: FetchLike,
  base: string,
  keyword: string
): Promise<NetdiskItem[]> {
  const json = await fetchJson(
    sameHostFetch(fetch),
    'PanSou',
    panSouEndpoint(base),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kw: keyword.trim(),
        cloud_types: ['115'],
        res: 'merge',
      }),
    }
  )
  return parsePanSouResponse(json)
}
