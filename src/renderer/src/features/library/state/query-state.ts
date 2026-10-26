/**
 * 海报墙的查询条件：排序、匹配状态筛选、分面筛选（番号库）、媒体库筛选、搜索词，及其到引擎 LibraryQuery 的映射。
 *
 * 每个查询都带分区的类型与来源（见 library-section.ts）。
 * 纯数据 + 纯函数，便于单测；响应式包装在 use-paged-query.ts。
 */
import type {
  FacetFilter,
  FacetListRequest,
  LibraryKind,
  LibraryQuery,
  LibrarySortField,
  MatchState,
  TopLevelItemType,
} from '../../../../../shared/library/ipc'
import { readStoredText, writeStoredText } from '@/utils/storage'

import { type LibrarySection, SECTIONS } from './library-section'

/** 界面提供的排序方式。 */
export type WallSort = Extract<
  LibrarySortField,
  'addedAt' | 'title' | 'year' | 'rating'
>

/** 匹配状态筛选。matched = 自动匹配 + 已锁定。 */
export type MatchFilter = 'all' | 'matched' | 'review' | 'unmatched' | 'locked'

/** 海报墙查询条件。 */
export interface WallQueryState {
  sort: WallSort
  order: 'asc' | 'desc'
  filter: MatchFilter
  /** 分面筛选（类型 / 标签 / 演员 / 制作商 / 系列 / 导演）；只有番号库用，其他分区忽略。 */
  facets: FacetFilter
  /** null 表示该类型的全部媒体库。 */
  libraryId: number | null
  search: string
}

/** 排序选项（顺序即菜单顺序）。 */
export const SORT_OPTIONS: ReadonlyArray<{ value: WallSort; label: string }> = [
  { value: 'addedAt', label: '添加时间' },
  { value: 'title', label: '片名' },
  { value: 'year', label: '年份' },
  { value: 'rating', label: '评分' },
]

/** 筛选选项。 */
export const FILTER_OPTIONS: ReadonlyArray<{
  value: MatchFilter
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'matched', label: '已匹配' },
  { value: 'review', label: '待确认' },
  { value: 'unmatched', label: '未匹配' },
  { value: 'locked', label: '已锁定' },
]

/** 每种排序的自然方向：片名升序，其余（新的、近的、高分的在前）降序。 */
export function defaultOrder(sort: WallSort): 'asc' | 'desc' {
  return sort === 'title' ? 'asc' : 'desc'
}

/** 默认查询：最近添加的在前。 */
export function defaultWallQuery(): WallQueryState {
  return {
    sort: 'addedAt',
    order: 'desc',
    filter: 'all',
    facets: {},
    libraryId: null,
    search: '',
  }
}

const FILTER_STATES: Record<MatchFilter, MatchState[] | undefined> = {
  all: undefined,
  matched: ['auto', 'locked'],
  review: ['review'],
  unmatched: ['unmatched'],
  locked: ['locked'],
}

/** 媒体库类型 → 海报墙展示的顶层条目类型。 */
export function topLevelType(kind: LibraryKind): TopLevelItemType {
  return kind === 'movie' ? 'movie' : 'series'
}

/** 分区的基础查询：顶层类型 + 来源（电影页不出番号条目，番号页只出番号条目）。 */
export function sectionQuery(
  section: LibrarySection
): Pick<LibraryQuery, 'types' | 'source'> {
  const spec = SECTIONS[section]
  return { types: [topLevelType(spec.kind)], source: spec.source }
}

/** 筛选条件（不含排序）的比较键：变了就清空多选、回到顶部。 */
export function filterKeyOf(state: WallQueryState): unknown[] {
  return [
    state.filter,
    JSON.stringify(state.facets),
    state.libraryId,
    state.search,
  ]
}

/** 有分面筛选的分区（番号库）。 */
const usesFacets = (section: LibrarySection): boolean => section === 'jav'

/** 分面面板的取值范围：与海报墙同一来源 / 媒体库；不用分面的分区返回 undefined。 */
export function facetScopeOf(
  section: LibrarySection,
  state: Pick<WallQueryState, 'libraryId'>
): Omit<FacetListRequest, 'field'> | undefined {
  if (!usesFacets(section)) return undefined
  return {
    source: SECTIONS[section].source,
    ...(state.libraryId !== null ? { libraryId: state.libraryId } : {}),
  }
}

/** 界面条件 → 引擎查询（不含 offset / limit，由分页列表补）。 */
export function toLibraryQuery(
  section: LibrarySection,
  state: WallQueryState
): LibraryQuery {
  const query: LibraryQuery = {
    ...sectionQuery(section),
    sort: state.sort,
    order: state.order,
  }
  const matchStates = FILTER_STATES[state.filter]
  if (matchStates) query.matchStates = matchStates
  if (usesFacets(section) && Object.keys(state.facets).length)
    query.facets = JSON.parse(JSON.stringify(state.facets)) as FacetFilter
  if (state.libraryId !== null) query.libraryId = state.libraryId
  const search = state.search.trim()
  if (search) query.search = search
  return query
}

/** 待确认队列的查询：待确认在前（同一状态按片名）。 */
export function reviewQuery(
  section: LibrarySection,
  matchStates: MatchState[] = ['review', 'unmatched']
): LibraryQuery {
  return {
    ...sectionQuery(section),
    matchStates,
    sort: 'title',
    order: 'asc',
  }
}

const STORAGE_PREFIX = 'library.wall.'

/** 读回上次的排序（每个分区各记一份）；搜索与筛选不记。 */
export function loadSavedSort(
  section: LibrarySection,
  storage: Pick<Storage, 'getItem'> = { getItem: readStoredText }
): Pick<WallQueryState, 'sort' | 'order'> | null {
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${section}`)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<WallQueryState>
    const sort = SORT_OPTIONS.find(o => o.value === saved.sort)?.value
    if (!sort) return null
    const order =
      saved.order === 'asc' || saved.order === 'desc'
        ? saved.order
        : defaultOrder(sort)
    return { sort, order }
  } catch {
    return null
  }
}

/** 记住排序。 */
export function saveSort(
  section: LibrarySection,
  state: Pick<WallQueryState, 'sort' | 'order'>,
  storage: Pick<Storage, 'setItem'> = { setItem: writeStoredText }
): void {
  storage.setItem(
    `${STORAGE_PREFIX}${section}`,
    JSON.stringify({ sort: state.sort, order: state.order })
  )
}
