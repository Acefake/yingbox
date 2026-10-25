/**
 * 把模型给的筛选串转成豆瓣浏览条件（纯函数）。
 *
 * 模型在 command 槽里写「类型=科幻;地区=美国;年代=90年代;排序=评分」，键值用 = 或 :，
 * 分隔用 ; ， , 或空格；value 槽可给评分下限。每个值都按 shared/douban/query.ts 的白名单收，
 * 认不出的丢掉（常见别名先换成白名单写法：香港 → 中国香港、1990s → 90年代、高分 → 评分排序）。
 * 一个条件都没认出来时返回 null，由助手降级成只回答文字。
 */
import {
  type DoubanKind,
  type DoubanQuery,
  type DoubanSort,
  GENRES,
  MIN_RATINGS,
  REGIONS,
  hasFilters,
  normalizeDoubanQuery,
} from '../../../../shared/douban/query'

const KEY_ALIASES: Record<string, keyof Filters> = {
  类型: 'genre',
  genre: 'genre',
  地区: 'region',
  region: 'region',
  国家: 'region',
  年代: 'era',
  年份: 'era',
  era: 'era',
  year: 'era',
  排序: 'sort',
  sort: 'sort',
}

const REGION_ALIASES: Record<string, string> = {
  香港: '中国香港',
  港: '中国香港',
  港片: '中国香港',
  大陆: '中国大陆',
  内地: '中国大陆',
  国产: '中国大陆',
  台湾: '中国台湾',
  台: '中国台湾',
  美: '美国',
  好莱坞: '美国',
  英: '英国',
  法: '法国',
  德: '德国',
  韩: '韩国',
  日: '日本',
  欧洲: '欧美',
}

const SORT_ALIASES: Record<string, DoubanSort> = {
  综合: 'U',
  热度: 'T',
  热门: 'T',
  近期热度: 'T',
  最新: 'R',
  时间: 'R',
  上映时间: 'R',
  评分: 'S',
  高分: 'S',
  u: 'U',
  t: 'T',
  r: 'R',
  s: 'S',
}

/** 认出来的筛选（都是白名单里的写法） */
interface Filters {
  genre: string
  region: string
  era: string
  sort: DoubanSort | ''
}

/** 年代写法统一：90年代 / 1990年代 / 1990s / 90s → 90年代；2010s → 2010年代；1997 → 1997 */
export function normalizeEra(text: string): string {
  const raw = text.trim().replace(/\s+/g, '')
  if (/^(?:19|20)\d{2}$/.test(raw)) return raw
  const m = /^(?:(19|20))?(\d)0(?:年代|s|'s)$/i.exec(raw)
  if (!m) return raw === '更早' ? raw : ''
  const century =
    m[1] ?? (m[2] === '0' || m[2] === '1' || m[2] === '2' ? '20' : '19')
  const decade = Number(`${century}${m[2]}0`)
  if (decade >= 2000) return `${decade}年代`
  if (decade >= 1980) return `${String(decade).slice(2)}年代`
  return '更早'
}

/** 拆出键值对 */
function pairs(command: string): Array<[string, string]> {
  return command
    .split(/[;；,，\s]+/)
    .map(part => part.split(/[=:：]/))
    .filter(kv => kv.length === 2 && kv[0].trim() && kv[1].trim())
    .map(([k, v]) => [k.trim().toLowerCase(), v.trim()])
}

/** 收一个值：白名单里有就用，有别名就换，否则空串 */
function pickValue(
  key: keyof Filters,
  value: string,
  kind: DoubanKind
): string {
  if (key === 'genre')
    return GENRES[kind].includes(value)
      ? value
      : (GENRES[kind].find(g => value.includes(g)) ?? '')
  if (key === 'region') {
    const alias = REGION_ALIASES[value] ?? value
    return REGIONS[kind].includes(alias) ? alias : ''
  }
  if (key === 'era') return normalizeEra(value)
  return SORT_ALIASES[value.toLowerCase()] ?? ''
}

/**
 * 模型的参数槽 → 豆瓣浏览条件。
 * @param target movie 或 tv（其他值返回 null）
 * @param command 筛选串
 * @param minRating 评分下限（只取 6 / 7 / 8 / 9，其他忽略）
 */
export function parseDiscoverQuery(
  target: string,
  command: string,
  minRating: number | null
): DoubanQuery | null {
  if (target !== 'movie' && target !== 'tv') return null
  const kind: DoubanKind = target
  const filters: Filters = { genre: '', region: '', era: '', sort: '' }
  for (const [key, value] of pairs(command)) {
    const field = KEY_ALIASES[key]
    if (!field || filters[field]) continue
    filters[field] = pickValue(field, value, kind) as never
  }
  const rating =
    minRating !== null && (MIN_RATINGS as readonly number[]).includes(minRating)
      ? minRating
      : 0
  const query = normalizeDoubanQuery({
    kind,
    genre: filters.genre,
    region: filters.region,
    era: filters.era,
    // 有筛选没排序时按评分排，挑出来的更像「推荐」
    sort: filters.sort || 'S',
    minRating: rating,
  })
  const named =
    filters.genre || filters.region || filters.era || filters.sort || rating > 0
  return named && hasFilters(query) ? query : null
}
