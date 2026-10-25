/**
 * PanSou（github.com/fish2018/pansou）聚合网盘搜索：POST {base}/api/search，只要 115、merge 结果。
 * 公共实例在外面包一层 { code, message, data }，自部署的 README 格式没有，两种都认。
 */
import type { NetdiskItem } from '../../shared/contract/pan115'
import { Pan115Error } from './errors'
import { type FetchLike, fetchJson, obj, text } from './http'
import { parseShareLink } from './share-link'

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
  for (const raw of list) {
    const entry = obj(raw)
    const url = text(entry.url)
    const ref = parseShareLink(url, text(entry.password))
    if (!ref) continue
    const datetime = text(entry.datetime)
    items.push({
      title: text(entry.note) || ref.shareCode,
      source: text(entry.source),
      // Go 的零值时间（0001-01-01）表示来源没给
      datetime:
        datetime && !datetime.startsWith('0001-') ? datetime : undefined,
      url,
      ...ref,
    })
  }
  return items
}

/** 搜一个关键词 */
export async function searchPanSou(
  fetch: FetchLike,
  base: string,
  keyword: string
): Promise<NetdiskItem[]> {
  const json = await fetchJson(fetch, 'PanSou', panSouEndpoint(base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kw: keyword.trim(),
      cloud_types: ['115'],
      res: 'merge',
    }),
  })
  return parsePanSouResponse(json)
}
