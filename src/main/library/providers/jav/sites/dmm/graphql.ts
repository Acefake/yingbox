/**
 * FANZA 动画（video.dmm.co.jp）前端用的 GraphQL 接口：api.video.dmm.co.jp/graphql，POST JSON，无需登录或密钥。
 *
 * 用到两个查询字段：
 * - ppvContent(id)：按 cid 取作品详情（标题、简介、配信日、时长、演员、厂牌、类别、封面、剧照、品番）；
 * - legacySearchPPV(queryWord)：站内检索，用来找带厂商码前缀的 cid（stars00100 → 1stars00100）。
 * 第一次请求把「按猜测 cid 取详情」和「按猜测 cid 检索」合在一个查询里（别名 content / search），
 * 猜中就一次拿全；猜不中再用检索到的 cid 取一次详情。最多两次请求。
 *
 * 实测（2026-10，美国出口）：接口可直接访问，www.dmm.co.jp 网页则跳转到地区限制页。
 * 封面 packageImage.largeUrl 即 pl.jpg（800×538 横版全图），mediumUrl 是 ps.jpg（147×200 竖版小图）；
 * 高清竖版海报应由上层从 pl.jpg 裁右半，这里只给地址。
 */
import { clean, isPlaceholder, unique } from '../../html'
import type { JavActor, JavRecord, PageOptions } from '../../types'
import { cidToCode } from './cid'

export const DMM_GRAPHQL = 'https://api.video.dmm.co.jp/graphql'

/** 作品详情要的字段（两个查询共用）。 */
const CONTENT_FIELDS = `id floor title description deliveryStartDate duration makerContentId
  actresses { name imageUrl } directors { name } series { name }
  maker { name } label { name } genres { name }
  packageImage { largeUrl mediumUrl } sampleImages { largeImageUrl }`

const LOOKUP_QUERY = `query JavLookup($id: ID!, $word: String!, $floor: PPVFloor) {
  content: ppvContent(id: $id) { ${CONTENT_FIELDS} }
  search: legacySearchPPV(limit: 10, sort: SALES_RANK_SCORE, floor: $floor, queryWord: $word) {
    result { contents { id } }
  }
}`

const CONTENT_QUERY = `query JavContent($id: ID!) {
  content: ppvContent(id: $id) { ${CONTENT_FIELDS} }
}`

/** GraphQL 是 POST JSON；Accept 换成 JSON，免得默认的 HTML Accept 被网关挑剔。 */
function graphqlRequest(
  operationName: string,
  query: string,
  variables: Record<string, unknown>
): PageOptions {
  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://video.dmm.co.jp',
      Referer: 'https://video.dmm.co.jp/',
    },
    body: JSON.stringify({ operationName, query, variables }),
  }
}

/**
 * 第一次请求：按猜测的 cid 取详情，同时用同一个词检索。
 *
 * @param floor AV（有码）或 AMATEUR（素人）；null 表示不限楼层
 */
export function lookupRequest(
  cid: string,
  floor: 'AV' | 'AMATEUR' | null
): PageOptions {
  return graphqlRequest('JavLookup', LOOKUP_QUERY, {
    id: cid,
    word: cid,
    floor,
  })
}

/** 第二次请求：按检索到的 cid 取详情。 */
export function contentRequest(cid: string): PageOptions {
  return graphqlRequest('JavContent', CONTENT_QUERY, { id: cid })
}

/** 接口里的名字对象。 */
interface Named {
  name?: string | null
  imageUrl?: string | null
}

/** ppvContent 的形状（只声明用到的字段，都可能是 null）。 */
export interface DmmContent {
  id?: string
  floor?: string | null
  title?: string | null
  description?: string | null
  deliveryStartDate?: string | null
  duration?: number | null
  makerContentId?: string | null
  actresses?: Named[] | null
  directors?: Named[] | null
  series?: Named | null
  maker?: Named | null
  label?: Named | null
  genres?: Named[] | null
  packageImage?: { largeUrl?: string | null; mediumUrl?: string | null } | null
  sampleImages?: Array<{ largeImageUrl?: string | null }> | null
}

/** 解析后的响应：详情（可能没有）与检索到的 cid 列表。 */
export interface DmmGraphqlResult {
  content?: DmmContent
  searchIds: string[]
}

/**
 * 解析 GraphQL 响应文本。返回 errors 且没有 data 时抛错（查询失效，不能当成查无此片缓存起来）。
 */
export function parseGraphql(text: string): DmmGraphqlResult {
  let body: {
    data?: {
      content?: DmmContent | null
      search?: {
        result?: { contents?: Array<{ id?: string }> | null } | null
      } | null
    } | null
    errors?: Array<{ message?: string }>
  }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    throw new Error('DMM GraphQL 返回的不是 JSON')
  }
  if (!body.data) {
    throw new Error(
      `DMM GraphQL 出错：${body.errors?.[0]?.message ?? '无数据'}`
    )
  }
  const ids = body.data.search?.result?.contents ?? []
  return {
    content: body.data.content ?? undefined,
    searchIds: unique(ids.map(c => c.id)),
  }
}

/**
 * 配信日 → 日本时间的 YYYY-MM-DD。
 *
 * 接口按请求方所在时区格式化时间，实测是「Fri 2022-08-19 9:00 AM CST (UTC+08:00)」，也可能是 ISO 8601；
 * FANZA 的上架时间以日本时间为准（常见 0 点或 10 点），直接取字面日期在别的时区会差一天，所以先换算回 UTC+9。
 */
export function jstDateOf(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  const date = /(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (!date) return undefined
  const time = /[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(text)
  const offset = /(?:UTC|GMT)?([+-])(\d{2}):?(\d{2})\)?\s*$/.exec(text.trim())
  const isUtc = /Z$/.test(text.trim())
  if (!time || (!offset && !isUtc)) return `${date[1]}-${date[2]}-${date[3]}`
  let hour = Number(time[1])
  const meridiem = time[3]?.toUpperCase()
  if (meridiem === 'AM' && hour === 12) hour = 0
  if (meridiem === 'PM' && hour < 12) hour += 12
  const offsetMin = offset
    ? (offset[1] === '-' ? -1 : 1) *
      (Number(offset[2]) * 60 + Number(offset[3]))
    : 0
  const utc = Date.UTC(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    hour,
    Number(time[2])
  )
  return new Date(utc - offsetMin * 60_000 + 9 * 3_600_000)
    .toISOString()
    .slice(0, 10)
}

/** 楼层 → 作品页路径段。 */
function floorPath(floor: string | null | undefined): string {
  return floor?.toUpperCase() === 'AMATEUR' ? 'amateur' : 'av'
}

/** 作品详情页地址（用户点开看的那页）。 */
export function dmmContentUrl(cid: string, floor?: string | null): string {
  return `https://video.dmm.co.jp/${floorPath(floor)}/content/?id=${encodeURIComponent(cid)}`
}

/** 名字列表去空去重。 */
function names(items: Named[] | null | undefined): string[] {
  return unique((items ?? []).map(item => clean(item.name ?? undefined)))
}

/** 详情 → 站点结果；没有标题（下架 / 不存在）返回 null。 */
export function dmmContentRecord(content: DmmContent): JavRecord | null {
  const title = clean(content.title ?? undefined)
  const cid = content.id
  if (!title || !cid) return null
  const actors: JavActor[] = []
  const seen = new Set<string>()
  for (const actress of content.actresses ?? []) {
    const name = clean(actress.name ?? undefined)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const photo = actress.imageUrl ?? undefined
    actors.push(photo && !isPlaceholder(photo) ? { name, photo } : { name })
  }
  const cover = content.packageImage?.largeUrl ?? undefined
  const poster = content.packageImage?.mediumUrl ?? undefined
  return {
    site: 'dmm',
    code: clean(content.makerContentId ?? undefined) ?? cidToCode(cid),
    url: dmmContentUrl(cid, content.floor),
    title,
    releaseDate: jstDateOf(content.deliveryStartDate),
    runtimeMinutes: content.duration
      ? Math.round(content.duration / 60)
      : undefined,
    director: names(content.directors)[0],
    studio: clean(content.maker?.name ?? undefined),
    label: clean(content.label?.name ?? undefined),
    series: clean(content.series?.name ?? undefined),
    tags: names(content.genres),
    actors,
    overview: clean(content.description?.replace(/<[^>]+>/g, ' ')),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    poster: poster && !isPlaceholder(poster) ? poster : undefined,
    stills: unique(
      (content.sampleImages ?? []).map(s => s.largeImageUrl ?? undefined)
    ),
  }
}
