/**
 * 豆瓣榜单（首页「豆瓣本周口碑榜」）：rexxar 的片单接口 /subject_collection/<id>/items。
 *
 * 片单接口的条目字段与 /recommend 列表相同（id、title、pic、rating、card_subtitle、type），
 * 只是外层叫 subject_collection_items；这里把外层换成 `{ items, total }`，之后与浏览共用
 * parseRecommend、页缓存、熔断和 frodo 回退（frodo 同一路径、同一形状，见 douban-browse.ts 的 chart）。
 */

/** 一周口碑电影榜（豆瓣电影首页右侧「一周口碑榜」，10 部） */
export const WEEKLY_MOVIE_CHART = 'movie_weekly_best'
/** 榜单取几部 */
export const CHART_COUNT = 10

const REXXAR = 'https://m.douban.com/rexxar/api/v2'

/** 片单接口地址 */
export function chartUrl(collection = WEEKLY_MOVIE_CHART): string {
  const search = new URLSearchParams({
    start: '0',
    count: String(CHART_COUNT),
  })
  return `${REXXAR}/subject_collection/${collection}/items?${search}`
}

type Json = Record<string, unknown>

/**
 * 片单响应 → rexxar 列表结构 `{ items, total }`；不是片单（没有 subject_collection_items 数组）时原样返回，
 * 交给 parseRecommend 报「不是条目列表」。
 */
export function chartToList(json: unknown): unknown {
  const body =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Json)
      : null
  const items = body?.subject_collection_items
  if (!Array.isArray(items)) return json
  return { items, total: items.length }
}
