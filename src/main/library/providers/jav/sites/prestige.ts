/**
 * PRESTIGE 官网（www.prestige-av.com）：读站点自己的 JSON 接口，不解析 HTML。
 *
 * 1. `/api/sku/item/<SKU>` 按候选 SKU 依次查（ABW-350 → ABW350 → GOOEABW-350 → GOOEABW350，GOOE 是特典版），
 *    命中取 parentProduct.uuid；SKU 不存在时站点回 404。
 * 2. `/api/product/<uuid>` 取作品详情（结果里的详情页地址用商品页 /goods/<uuid>）。图片在站点 /api/media/ 下：thumbnail 是竖版前封（海报），
 *    packageImage 是横版整幅（封面），media 是剧照。
 * `/api/search` 只索引在售商品且是模糊匹配，不用。站点限日本 IP，海外访问回 CloudFront 403。
 * 只查前缀表里的 PRESTIGE 系番号，其它番号不发请求（每部最多要试 4 个 SKU）。
 */
import type { JavCode } from '../number'
import { clean, dateOf, list, str, unique } from '../html'
import type { JavRecord, JavSite, JavSiteId, SiteContext } from '../types'

export const PRESTIGE_BASE = 'https://www.prestige-av.com'

const SITE_ID = 'prestige' as JavSiteId

const JSON_OPTIONS = { headers: { Accept: 'application/json' } }

/**
 * PRESTIGE 及旗下厂牌的番号前缀（大写）。整理自公开的厂牌品番资料，新厂牌在这里补。
 */
const PREFIX_LIST =
  'ABF ABP ABW ABS AKA AOI BGN BLO CHN DIC DOCP DTT EDD ESK EVO FIV FTN GETS GNAB HAR HIZ INU JAN JBS KBI KIL MAS MBM MCT ONEZ PPT PXH RAW SGA SHS SIM SRS TEM TGAV THU TRD WAT WPS YRH ZZR'

export const PRESTIGE_PREFIXES: ReadonlySet<string> = new Set(
  PREFIX_LIST.split(' ')
)

type Obj = Record<string, unknown>

/** 番号 → 候选 SKU（按命中可能性排序）。 */
export function prestigeSkus(code: string): string[] {
  const dashed = code.toUpperCase()
  const bare = dashed.replace(/-/g, '')
  return unique([dashed, bare, `GOOE${dashed}`, `GOOE${bare}`])
}

/** JSON 文本 → 对象；不是对象返回 undefined。 */
function objectOf(body: string | null): Obj | undefined {
  if (!body) return undefined
  try {
    const data = JSON.parse(body) as unknown
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Obj)
      : undefined
  } catch {
    return undefined
  }
}

/** maker / label / series 可能是对象、对象数组或字符串，取 name。 */
function nameOf(value: unknown): string | undefined {
  if (typeof value === 'string') return clean(value)
  if (Array.isArray(value)) return nameOf(value[0])
  return str(value, 'name')
}

/** 站点内图片路径 → 绝对地址。 */
function mediaUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  return /^https?:/i.test(path) ? path : `${PRESTIGE_BASE}/api/media/${path}`
}

/**
 * 作品详情 JSON → 站点结果；没有番号返回 null。
 *
 * @param url 商品页地址（/goods/<uuid>?skuId=<SKU>）
 */
export function prestigeRecord(product: Obj, url: string): JavRecord | null {
  // 番号取通常版 SKU；GOO / GOOE 开头的是特典版
  const skus = list(product, 'sku')
    .map(s => str(s, 'deliveryItemId'))
    .filter((s): s is string => Boolean(s))
  const code = skus.find(s => !s.startsWith('GOO')) ?? skus[0]
  if (!code) return null
  const names = (key: string): string[] =>
    unique(list(product, key).map(item => str(item, 'name')))
  const playTime = product.playTime
  return {
    site: SITE_ID,
    code,
    url,
    title: str(product, 'title'),
    releaseDate: dateOf(
      str(product, 'mgsStartAt') ?? str(product, 'createdAt')
    ),
    runtimeMinutes:
      typeof playTime === 'number' && playTime > 0 ? playTime : undefined,
    director: names('directors')[0],
    studio: 'プレステージ',
    label: nameOf(product.label) ?? nameOf(product.maker),
    series: nameOf(product.series),
    tags: names('genre'),
    actors: names('actress').map(name => ({ name })),
    overview: str(product, 'body'),
    cover: mediaUrl(str(product.packageImage, 'path')),
    poster: mediaUrl(str(product.thumbnail, 'path')),
    stills: unique(list(product, 'media').map(m => mediaUrl(str(m, 'path')))),
  }
}

/** 是不是 PRESTIGE 系番号（看字母前缀）。 */
function isPrestigeCode(code: string): boolean {
  const prefix = /^\d*([A-Z]+)-/.exec(code.toUpperCase())?.[1]
  return prefix !== undefined && PRESTIGE_PREFIXES.has(prefix)
}

/** PRESTIGE 站点。 */
export const prestige: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    if (!isPrestigeCode(target.code)) return null
    for (const sku of prestigeSkus(target.code)) {
      const item = objectOf(
        await ctx.page(
          `${PRESTIGE_BASE}/api/sku/item/${encodeURIComponent(sku)}`,
          JSON_OPTIONS
        )
      )
      const uuid = str(item?.parentProduct, 'uuid')
      if (!uuid) continue
      const id = encodeURIComponent(uuid)
      const product = objectOf(
        await ctx.page(`${PRESTIGE_BASE}/api/product/${id}`, JSON_OPTIONS)
      )
      const page = `${PRESTIGE_BASE}/goods/${id}?skuId=${encodeURIComponent(sku)}`
      return product ? prestigeRecord(product, page) : null
    }
    return null
  },
}
