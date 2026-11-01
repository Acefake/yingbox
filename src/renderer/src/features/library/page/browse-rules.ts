/**
 * 片库「全部」一段的纯规则：排序菜单钮的文字、浏览胶囊（全部 / 未看 / 最近添加 | 常见类型）的选中与切换、
 * 待确认提示、排序菜单里的匹配状态与文件夹分组。
 * 不依赖 Vue，便于单测。
 */
import type { FacetValue } from '../../../../../shared/library/ipc'
import {
  type BrowseMode,
  FILTER_OPTIONS,
  type MatchFilter,
  SORT_OPTIONS,
  type WallQueryState,
  type WallSort,
} from '../state/query-state'

/** 胶囊行直接列出的类型数。 */
export const TOP_GENRES = 9

/** 浏览胶囊。 */
export const BROWSE_OPTIONS: ReadonlyArray<{
  value: BrowseMode
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'unwatched', label: '未看' },
  { value: 'watchlist', label: '想看' },
  { value: 'recent', label: '最近添加' },
]

/** 排序钮的文字：字段名 + 方向箭头，如「添加时间 ↓」。 */
export function sortLabel(sort: WallSort, order: 'asc' | 'desc'): string {
  const label = SORT_OPTIONS.find(o => o.value === sort)?.label ?? sort
  return `${label} ${order === 'asc' ? '↑' : '↓'}`
}

/**
 * 排序菜单钮的文字：选了非默认的匹配状态或某个文件夹时放在排序前面（如「未匹配 · 添加时间 ↓」），
 * 收在菜单里的筛选也看得见。
 */
export function wallMenuLabel(
  sort: WallSort,
  order: 'asc' | 'desc',
  filter: MatchFilter,
  libraryLabel: string | null
): string {
  const parts: string[] = []
  if (filter !== 'all') {
    const label = FILTER_OPTIONS.find(o => o.value === filter)?.label
    if (label) parts.push(label)
  }
  if (libraryLabel) parts.push(libraryLabel)
  parts.push(sortLabel(sort, order))
  return parts.join(' · ')
}

/** 在排序菜单里点了某个字段：点当前字段切换升降序，点别的字段换字段。 */
export function sortPick(
  current: WallSort,
  picked: WallSort
): { kind: 'toggle-order' } | { kind: 'sort'; sort: WallSort } {
  return picked === current
    ? { kind: 'toggle-order' }
    : { kind: 'sort', sort: picked }
}

/**
 * 胶囊行列出的类型：按片数取前 n 个；选中的类型不在其中时换掉最后一个，保证选中的胶囊看得见。
 */
export function topGenres(
  values: readonly FacetValue[],
  selected: string | null,
  n = TOP_GENRES
): FacetValue[] {
  const top = values.slice(0, n)
  if (!selected || top.some(v => v.value === selected)) return top
  const found = values.find(v => v.value === selected) ?? {
    value: selected,
    count: 0,
  }
  return [...top.slice(0, Math.max(0, n - 1)), found]
}

/** 浏览胶囊是否选中：「全部」= 不限观看与类型；未看 / 最近添加看 browse。 */
export function browseSelected(
  state: Pick<WallQueryState, 'browse' | 'genre'>,
  value: BrowseMode
): boolean {
  if (value === 'all') return state.browse === 'all' && state.genre === null
  return state.browse === value
}

/**
 * 点浏览胶囊后的条件：「全部」清掉观看与类型；未看 / 最近添加再点一次取消。
 * 观看与类型可以叠加（如「未看 · 科幻」）。
 */
export function pickBrowse(
  state: Pick<WallQueryState, 'browse' | 'genre'>,
  value: BrowseMode
): Pick<WallQueryState, 'browse' | 'genre'> {
  if (value === 'all') return { browse: 'all', genre: null }
  return {
    browse: state.browse === value ? 'all' : value,
    genre: state.genre,
  }
}

/** 点类型胶囊（或浮层里的类型）：选中它，再点一次取消。 */
export function pickGenre(
  current: string | null,
  genre: string
): string | null {
  return current === genre ? null : genre
}

/** 待确认提示的文字；0 时不显示（null）。 */
export function reviewHintText(count: number): string | null {
  return count > 0 ? `${count.toLocaleString('zh-CN')} 部待确认` : null
}

/** 排序菜单里一项单选的描述（动作由「全部」一段补上）。 */
export interface MenuChoice<T> {
  key: string
  label: string
  group: string
  checked: boolean
  value: T
}

/** 匹配状态分组：全部 / 已匹配 / 未匹配 / 已锁定（待确认走标题下的提示，不在这里）。 */
export function matchChoices(filter: MatchFilter): MenuChoice<MatchFilter>[] {
  return FILTER_OPTIONS.filter(o => o.value !== 'review').map(o => ({
    key: `match-${o.value}`,
    label: o.label,
    group: '匹配状态',
    checked: filter === o.value,
    value: o.value,
  }))
}

/** 文件夹分组：只有一个文件夹（选项只有「全部文件夹」+ 1）时不列。 */
export function libraryChoices(
  options: ReadonlyArray<{ value: number; label: string }>,
  library: number
): MenuChoice<number>[] {
  if (options.length <= 2) return []
  return options.map(o => ({
    key: `lib-${o.value}`,
    label: o.label,
    group: '文件夹',
    checked: library === o.value,
    value: o.value,
  }))
}
