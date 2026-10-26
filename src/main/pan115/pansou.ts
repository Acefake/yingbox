/**
 * PanSou（github.com/fish2018/pansou）聚合网盘搜索：POST {base}/api/search，merge 结果。
 * 要 115 分享，界面搜索时再要磁力（magnet）与电驴（ed2k），115 离线下载两种都支持。
 * 公共实例在外面包一层 { code, message, data }，自部署的 README 格式没有，两种都认。
 *
 * 出网范围：地址由用户在设置里填（可能是局域网 NAS），所以不做私网拦截；但重定向手动处理，
 * 只跟到同一主机（http.ts 的 sameHostFetch），请求只会到用户填的那台机器。
 * 115 分享最多 {@link MAX_RESULTS} 条、按分享去重；磁力按哈希去重（magnet-link.ts）；标题 / 来源截断长度。
 */
import type { MagnetItem, NetdiskItem } from '../../shared/contract/pan115'
import { Pan115Error } from './errors'
import { type FetchLike, fetchJson, obj, sameHostFetch, text } from './http'
import { MAX_MAGNETS, mergeMagnets, parseOfflineLink } from './magnet-link'
import { parseShareLink } from './share-link'

/** 一次搜索最多返回的 115 分享条数 */
export const MAX_RESULTS = 200
const MAX_TITLE = 200
const MAX_SOURCE = 80

/** 一次 PanSou 搜索的结果 */
export interface PanSouResult {
  shares: NetdiskItem[]
  magnets: MagnetItem[]
}

/** 设置里的 PanSou 地址 → 搜索接口地址；不是 http(s) 时抛错 */
export function panSouEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed))
    throw new Pan115Error('PanSou 地址应以 http:// 或 https:// 开头')
  return `${trimmed}/api/search`
}

/** Go 的零值时间（0001-01-01）表示来源没给 */
function datetimeOf(value: unknown): string | undefined {
  const datetime = text(value)
  return datetime && !datetime.startsWith('0001-') ? datetime : undefined
}

/** merged_by_type 里某一类的列表 */
function listOf(merged: Record<string, unknown>, type: string): unknown[] {
  const list = merged[type]
  return Array.isArray(list) ? list : []
}

/** 115 分享：只留能解析出分享码的，按分享码 + 提取码去重 */
function sharesOf(list: unknown[]): NetdiskItem[] {
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
    items.push({
      title: (text(entry.note) || ref.shareCode).slice(0, MAX_TITLE),
      source: text(entry.source).slice(0, MAX_SOURCE),
      datetime: datetimeOf(entry.datetime),
      url,
      ...ref,
    })
  }
  return items
}

/** 磁力 / 电驴：只留能解析出哈希的；标题缺省用链接里的名字 */
function magnetsOf(list: unknown[]): MagnetItem[] {
  const items: MagnetItem[] = []
  for (const raw of list) {
    const entry = obj(raw)
    const link = text(entry.url).trim()
    const parsed = parseOfflineLink(link)
    if (!parsed) continue
    items.push({
      title: (text(entry.note) || parsed.name || parsed.hash).slice(
        0,
        MAX_TITLE
      ),
      origin: 'pansou',
      source: text(entry.source).slice(0, MAX_SOURCE),
      kind: parsed.kind,
      link,
      hash: parsed.hash,
      datetime: datetimeOf(entry.datetime),
      size: parsed.size,
    })
  }
  return mergeMagnets([items], MAX_MAGNETS)
}

/** 解析搜索响应：115 分享 + 磁力 / 电驴 */
export function parsePanSouResponse(json: unknown): PanSouResult {
  const root = obj(json)
  if (!Object.keys(root).length) throw new Pan115Error('PanSou 返回格式不认识')
  if (typeof root.code === 'number' && root.code !== 0)
    throw new Pan115Error(
      text(root.message) || `PanSou 返回错误（${root.code}）`
    )
  const merged = obj(obj('data' in root ? root.data : root).merged_by_type)
  return {
    shares: sharesOf(listOf(merged, '115')),
    magnets: magnetsOf([
      ...listOf(merged, 'magnet'),
      ...listOf(merged, 'ed2k'),
    ]),
  }
}

/**
 * 搜一个关键词。
 * @param withMagnets 是否同时要磁力与电驴（界面搜索要；追更只认 115 分享，不要）
 */
export async function searchPanSou(
  fetch: FetchLike,
  base: string,
  keyword: string,
  withMagnets = false
): Promise<PanSouResult> {
  const json = await fetchJson(
    sameHostFetch(fetch, 'PanSou'),
    'PanSou',
    panSouEndpoint(base),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kw: keyword.trim(),
        cloud_types: withMagnets ? ['115', 'magnet', 'ed2k'] : ['115'],
        res: 'merge',
      }),
    }
  )
  return parsePanSouResponse(json)
}
