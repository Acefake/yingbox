/**
 * 浏览页的筛选胶囊：排序 / 地区 / 年代 / 评分 四个下拉，以及右侧「已选条件」chip 和清除。
 * 只做 豆瓣查询条件 ↔ 界面 的换算；取数、记住条件仍在 use-douban-feed。
 */
import {
  type DoubanQuery,
  type DoubanSort,
  MIN_RATINGS,
  REGIONS,
  SORTS,
  eraOptions,
} from '../../../../../shared/douban/query'

/** 可筛的维度 */
export type FilterKey = 'sort' | 'region' | 'era' | 'rating'

/** 下拉里的一个选项 */
export interface FilterOption {
  value: string
  label: string
}

/** 一个筛选胶囊 */
export interface FilterPill {
  key: FilterKey
  label: string
  /** 当前值（rating 为分数字符串） */
  value: string
  /** 胶囊上显示的文字：「排序 · 综合」「地区 · 欧美」「年代」 */
  text: string
  /** 动过（非默认值）：胶囊高亮，右侧出 chip */
  active: boolean
  options: FilterOption[]
}

/** 已选条件的一个 chip */
export interface FilterChip {
  key: FilterKey
  label: string
}

const ratingLabel = (n: number): string => (n ? `${n} 分以上` : '不限')

const opt = (value: string, label = value): FilterOption => ({ value, label })

/** 四个胶囊（年份档按 year 生成，测试可固定） */
export function filterPills(
  q: DoubanQuery,
  year = new Date().getFullYear()
): FilterPill[] {
  const sortLabel = SORTS.find(s => s.value === q.sort)?.label ?? '综合'
  const pill = (
    key: FilterKey,
    label: string,
    value: string,
    valueLabel: string,
    active: boolean,
    options: FilterOption[]
  ): FilterPill => ({
    key,
    label,
    value,
    // 排序总有一个值，一直写在胶囊里；其余选了才写
    text: active || key === 'sort' ? `${label} · ${valueLabel}` : label,
    active,
    options,
  })
  return [
    pill(
      'sort',
      '排序',
      q.sort,
      sortLabel,
      q.sort !== 'U',
      SORTS.map(s => opt(s.value, s.label))
    ),
    pill('region', '地区', q.region, q.region, !!q.region, [
      opt('', '全部'),
      ...REGIONS[q.kind].map(r => opt(r)),
    ]),
    pill('era', '年代', q.era, q.era, !!q.era, [
      opt('', '全部'),
      ...eraOptions(year).map(e => opt(e)),
    ]),
    pill(
      'rating',
      '评分',
      String(q.minRating),
      ratingLabel(q.minRating),
      q.minRating > 0,
      MIN_RATINGS.map(n => opt(String(n), ratingLabel(n)))
    ),
  ]
}

/** 右侧的已选条件（按胶囊顺序） */
export function filterChips(q: DoubanQuery): FilterChip[] {
  return filterPills(q)
    .filter(p => p.active)
    .map(p => ({
      key: p.key,
      label: p.options.find(o => o.value === p.value)?.label ?? p.value,
    }))
}

/** 选了某个胶囊的某个值 → 要改的条件 */
export function filterPatch(
  key: FilterKey,
  value: string
): Partial<DoubanQuery> {
  switch (key) {
    case 'sort':
      return { sort: value as DoubanSort }
    case 'rating':
      return { minRating: Number(value) || 0 }
    default:
      return { [key]: value }
  }
}

/** 去掉一个已选条件 */
export const clearFilterPatch = (key: FilterKey): Partial<DoubanQuery> =>
  filterPatch(key, key === 'sort' ? 'U' : key === 'rating' ? '0' : '')

/** 「清除」：四个维度都回默认（类型不动） */
export const CLEAR_ALL_PATCH: Partial<DoubanQuery> = {
  sort: 'U',
  region: '',
  era: '',
  minRating: 0,
}
