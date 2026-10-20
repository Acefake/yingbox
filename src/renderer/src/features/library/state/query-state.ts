/**
 * 海报墙的查询条件：排序、匹配状态筛选、媒体库筛选、搜索词，及其到引擎 LibraryQuery 的映射。
 *
 * 纯数据 + 纯函数，便于单测；响应式包装在 use-library-query.ts。
 */
import type {
  LibraryKind,
  LibraryQuery,
  LibrarySortField,
  MatchState,
  TopLevelItemType,
} from '../../../../../shared/library/ipc'

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

/** 界面条件 → 引擎查询（不含 offset / limit，由分页列表补）。 */
export function toLibraryQuery(
  kind: LibraryKind,
  state: WallQueryState
): LibraryQuery {
  const query: LibraryQuery = {
    types: [topLevelType(kind)],
    sort: state.sort,
    order: state.order,
  }
  const matchStates = FILTER_STATES[state.filter]
  if (matchStates) query.matchStates = matchStates
  if (state.libraryId !== null) query.libraryId = state.libraryId
  const search = state.search.trim()
  if (search) query.search = search
  return query
}

/** 待确认队列的查询：待确认在前（同一状态按片名）。 */
export function reviewQuery(
  kind: LibraryKind,
  matchStates: MatchState[] = ['review', 'unmatched']
): LibraryQuery {
  return {
    types: [topLevelType(kind)],
    matchStates,
    sort: 'title',
    order: 'asc',
  }
}

const STORAGE_PREFIX = 'library.wall.'

/** 读回上次的排序（每种媒体库各记一份）；搜索与筛选不记。 */
export function loadSavedSort(
  kind: LibraryKind,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage
): Pick<WallQueryState, 'sort' | 'order'> | null {
  try {
    const raw = storage?.getItem(`${STORAGE_PREFIX}${kind}`)
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
  kind: LibraryKind,
  state: Pick<WallQueryState, 'sort' | 'order'>,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage
): void {
  storage?.setItem(
    `${STORAGE_PREFIX}${kind}`,
    JSON.stringify({ sort: state.sort, order: state.order })
  )
}
