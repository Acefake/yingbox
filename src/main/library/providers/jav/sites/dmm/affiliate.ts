/**
 * DMM 官方商品情报 API（DMM Web Service v3，api.dmm.com/affiliate/v3/ItemList）。
 *
 * 需要用户自己在 DMM 联盟申请的 API ID 与 Affiliate ID（形如 xxx-990）；没配置时 supports 返回 false，
 * 聚合时自动跳过，不发任何请求。配置来源由调用方注入（createDmmApi 的参数），
 * 内置实例读环境变量 DMM_API_ID / DMM_AFFILIATE_ID（NAS / Docker 部署方便）。
 *
 * 查询：先 cid=<补零 cid> 精确取（site=FANZA、service=digital、floor=videoa），
 * 取不到再 keyword=<番号> 检索并用 cid 主体核对（带厂商码前缀的 1stars00100 一类）。
 * 接口出错时 HTTP 仍是 200，状态在 result.status（400 = 参数 / ID 错误），按失败抛错、不缓存。
 * 字段：imageURL.large 是 pl.jpg 横版封面、small 是 ps.jpg 竖版小图；sampleImageURL.sample_l 是剧照大图；
 * volume 是时长（分钟或 HH:MM:SS）；date 是日本时间「YYYY-MM-DD HH:MM:SS」。
 * Amane 的 dmm_api.py 只是 GraphQL 的数据模型（见 graphql.ts），官方 API 这部分按 DMM 公开文档独立实现；
 * 没有可用的 API ID，响应结构未用真实数据验证。
 */
import { clean, dateOf, isPlaceholder, minutesOf, unique } from '../../html'
import type { JavCode } from '../../number'
import type { JavRecord, JavSite, PageOptions, SiteContext } from '../../types'
import { type DmmCid, cidToCode, dmmCid, pickCid } from './cid'

export const DMM_API_BASE = 'https://api.dmm.com/affiliate/v3/ItemList'

/** 官方 API 凭据。 */
export interface DmmApiCredentials {
  apiId: string
  /** 联盟 ID，形如 xxx-990（API 要求 990–999 结尾的那个）。 */
  affiliateId: string
}

/** 环境变量里的凭据；缺任何一个返回 undefined。 */
export function credentialsFromEnv(
  env: Record<string, string | undefined>
): DmmApiCredentials | undefined {
  const apiId = env.DMM_API_ID?.trim()
  const affiliateId = env.DMM_AFFILIATE_ID?.trim()
  return apiId && affiliateId ? { apiId, affiliateId } : undefined
}

/** ItemList 请求地址。 */
export function dmmApiUrl(
  credentials: DmmApiCredentials,
  query: { cid: string } | { keyword: string }
): string {
  const params = new URLSearchParams({
    api_id: credentials.apiId,
    affiliate_id: credentials.affiliateId,
    site: 'FANZA',
    service: 'digital',
    floor: 'videoa',
    hits: '10',
    output: 'json',
    ...query,
  })
  return `${DMM_API_BASE}?${params.toString()}`
}

const OPTIONS: PageOptions = { headers: { Accept: 'application/json' } }

/** iteminfo 里的一项。 */
interface Info {
  name?: string
}

/** ItemList 的一个商品（只声明用到的字段）。 */
export interface DmmApiItem {
  content_id?: string
  title?: string
  URL?: string
  date?: string
  volume?: string
  imageURL?: { list?: string; small?: string; large?: string }
  sampleImageURL?: {
    sample_s?: { image?: string[] }
    sample_l?: { image?: string[] }
  }
  iteminfo?: Partial<
    Record<
      'genre' | 'maker' | 'label' | 'series' | 'actress' | 'director',
      Info[]
    >
  >
}

/** 解析响应：返回商品列表；接口报错抛错。 */
export function parseDmmApi(text: string): DmmApiItem[] {
  let body: {
    result?: {
      status?: number | string
      message?: string
      errors?: unknown
      items?: DmmApiItem[]
    }
  }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    throw new Error('DMM API 返回的不是 JSON')
  }
  const status = Number(body.result?.status)
  if (status !== 200) {
    const detail = body.result?.errors ? JSON.stringify(body.result.errors) : ''
    throw new Error(
      `DMM API 出错（${body.result?.status ?? '无状态'}）${detail}`
    )
  }
  return body.result?.items ?? []
}

/** iteminfo 某一类的名字。 */
function infoNames(
  item: DmmApiItem,
  key: keyof NonNullable<DmmApiItem['iteminfo']>
): string[] {
  return unique((item.iteminfo?.[key] ?? []).map(i => clean(i.name)))
}

/** 商品 → 站点结果；缺 cid 或标题返回 null。 */
export function dmmApiRecord(item: DmmApiItem): JavRecord | null {
  const cid = item.content_id
  const title = clean(item.title)
  if (!cid || !title) return null
  const cover = item.imageURL?.large
  const poster = item.imageURL?.small
  const samples =
    item.sampleImageURL?.sample_l?.image ?? item.sampleImageURL?.sample_s?.image
  return {
    site: 'dmm_api',
    code: cidToCode(cid),
    url:
      item.URL ??
      `https://video.dmm.co.jp/av/content/?id=${encodeURIComponent(cid)}`,
    title,
    releaseDate: dateOf(item.date),
    runtimeMinutes: minutesOf(item.volume),
    director: infoNames(item, 'director')[0],
    studio: infoNames(item, 'maker')[0],
    label: infoNames(item, 'label')[0],
    series: infoNames(item, 'series')[0],
    tags: infoNames(item, 'genre'),
    actors: infoNames(item, 'actress').map(name => ({ name })),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    poster: poster && !isPlaceholder(poster) ? poster : undefined,
    stills: unique(samples ?? []),
  }
}

/** 列表里挑 cid 对得上的商品。 */
export function pickDmmApiItem(
  items: DmmApiItem[],
  cid: DmmCid
): DmmApiItem | undefined {
  const id = pickCid(
    items.map(i => i.content_id ?? ''),
    cid
  )
  return id ? items.find(i => i.content_id === id) : undefined
}

/**
 * 创建官方 API 站点。
 *
 * @param credentials 每次查询时读取当前凭据；返回 undefined 表示未配置（站点不参与聚合）
 */
export function createDmmApi(
  credentials: () => DmmApiCredentials | undefined
): JavSite {
  return {
    id: 'dmm_api',
    supports: kind =>
      (kind === 'censored' || kind === 'amateur') && Boolean(credentials()),
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      const auth = credentials()
      const cid = dmmCid(target.code)
      if (!auth || !cid) return null
      const exact = await ctx.page(
        dmmApiUrl(auth, { cid: cid.padded }),
        OPTIONS
      )
      const hit = exact ? pickDmmApiItem(parseDmmApi(exact), cid) : undefined
      if (hit) return dmmApiRecord(hit)
      const search = await ctx.page(
        dmmApiUrl(auth, { keyword: target.code }),
        OPTIONS
      )
      const found = search
        ? pickDmmApiItem(parseDmmApi(search), cid)
        : undefined
      return found ? dmmApiRecord(found) : null
    },
  }
}

/** 内置实例：凭据来自环境变量 DMM_API_ID / DMM_AFFILIATE_ID。 */
export const dmmApi: JavSite = createDmmApi(() =>
  credentialsFromEnv(process.env)
)
