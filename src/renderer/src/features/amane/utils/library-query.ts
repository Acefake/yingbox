/**
 * Amane 片库页的纯规则：视图与排序选项、列表查询参数、评分排序、
 * 无限滚动判定、整理任务的确认文案。
 */
import type { AmaneFile, AmaneFilm, AmaneLibrary } from '../api/amane'

/** 片库页的视图 */
export type AmaneTab =
  | 'agent'
  | 'films'
  | 'actors'
  | 'libraries'
  | 'files'
  | 'tasks'

/** 顶部视图切换（UiSegmented）；点当前项也会重新加载，与旧的标签按钮一致 */
export const TAB_OPTIONS: { value: AmaneTab; label: string }[] = [
  { value: 'agent', label: '智能体' },
  { value: 'films', label: '片库' },
  { value: 'actors', label: '演员' },
  { value: 'libraries', label: '媒体库' },
  { value: 'files', label: '文件' },
  { value: 'tasks', label: '任务' },
]

/** 每页条数 */
export const PAGE_SIZE = 36

/** 有搜索框、按滚动自动加载更多的视图 */
export const SCROLL_TABS: AmaneTab[] = ['films', 'actors', 'files']

/** 各视图对应的 Amane 资源 */
export const RESOURCES: Record<string, string> = {
  films: 'metadata',
  actors: 'actors',
  libraries: 'libraries',
  tasks: 'tasks',
  files: 'media',
}

export type MetadataSortField =
  | 'updated_at'
  | 'created_at'
  | 'number'
  | 'title'
  | 'studio'
  | 'release'
  | 'score'
  | 'file_count'
export type SortOrder = 'asc' | 'desc'

/** 评分通过前端完整结果排序，其余字段交由 Amane 后台排序。 */
export const SORT_OPTIONS: { value: MetadataSortField; label: string }[] = [
  { value: 'updated_at', label: '更新时间' },
  { value: 'created_at', label: '创建时间' },
  { value: 'number', label: '番号' },
  { value: 'title', label: '标题' },
  { value: 'studio', label: '制作商' },
  { value: 'release', label: '发行日期' },
  { value: 'score', label: '评分' },
  { value: 'file_count', label: '关联文件' },
]

/** 排序按钮上显示的字段名 */
export const sortLabel = (field: MetadataSortField): string =>
  SORT_OPTIONS.find(option => option.value === field)?.label || '更新时间'

/** 点排序菜单项：同字段切换升降序，换字段默认降序 */
export function nextSort(
  current: { field: MetadataSortField; order: SortOrder },
  chosen: MetadataSortField
): { field: MetadataSortField; order: SortOrder } {
  if (current.field === chosen)
    return { field: chosen, order: current.order === 'asc' ? 'desc' : 'asc' }
  return { field: chosen, order: 'desc' }
}

/** 搜索框占位文字 */
export const searchPlaceholder = (tab: AmaneTab): string =>
  tab === 'actors'
    ? '搜索演员'
    : tab === 'files'
      ? '搜索文件或番号'
      : '搜索片名、番号'

/** 列表筛选条件 */
export interface ListFilters {
  tab: AmaneTab
  page: number
  search: string
  sortField: MetadataSortField
  sortOrder: SortOrder
  advanced: Record<string, string[]>
  actorId: number | null
  tagId: number | null
  libraryId: number | null
  taskStatus: string
}

/** 一页列表的查询参数（评分排序时后台按更新时间降序，前端再排） */
export function listQuery(filters: ListFilters): URLSearchParams {
  const { tab } = filters
  const query = new URLSearchParams({
    offset: String(filters.page * PAGE_SIZE),
    limit: String(PAGE_SIZE),
  })
  if (filters.search.trim() && SCROLL_TABS.includes(tab))
    query.set('search', filters.search.trim())
  if (tab === 'films') {
    const byScore = filters.sortField === 'score'
    query.set('sort_by', byScore ? 'updated_at' : filters.sortField)
    query.set('order', byScore ? 'desc' : filters.sortOrder)
    for (const [key, values] of Object.entries(filters.advanced))
      for (const value of values) query.append(key, value)
    if (filters.actorId) query.set('actor_id', String(filters.actorId))
    if (filters.tagId) query.set('tag_id', String(filters.tagId))
  }
  if (tab === 'files' && filters.libraryId)
    query.set('library_id', String(filters.libraryId))
  if (tab === 'tasks' && filters.taskStatus)
    query.set('status', filters.taskStatus)
  return query
}

/** 评分排序：按 id 去重；没有评分的排最后；同分按发行日期新→旧，再按 id */
export function sortByScore(
  items: AmaneFilm[],
  direction: SortOrder
): AmaneFilm[] {
  const unique = Array.from(
    new Map(items.map(item => [item.id, item])).values()
  )
  return unique.sort((a, b) => {
    if (a.score == null && b.score != null) return 1
    if (b.score == null && a.score != null) return -1
    const difference = (a.score ?? 0) - (b.score ?? 0)
    return (
      (direction === 'asc' ? difference : -difference) ||
      (b.release || '').localeCompare(a.release || '') ||
      a.id - b.id
    )
  })
}

/** 还有下一页 */
export const hasMore = (page: number, total: number): boolean =>
  (page + 1) * PAGE_SIZE < total

/** 滚到离底部 480px 以内时加载下一页 */
export const nearBottom = (list: {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}): boolean => list.scrollTop + list.clientHeight >= list.scrollHeight - 480

/** 媒体库自动化方式的名字 */
export const AUTOMATION_NAMES: Record<AmaneLibrary['automation'], string> = {
  none: '手动扫描',
  watch: '监控新文件',
  scrape: '监控并刮削',
}

/** 整理单个 / 多个文件前的确认文案（只含已刮削的文件） */
export function organizeFilesConfirm(files: AmaneFile[]): string {
  const preview = files.map(file => file.path).join('\n')
  const head =
    files.length === 1
      ? '整理这一条会做三件事：\n· 按媒体库模板把视频搬进子目录（文件会被移动）\n· 在旁边写出封面/海报（水印打在这两个文件上）\n· 写出 .nfo'
      : `整理这 ${files.length} 条会移动这些视频文件，并在旁边写出封面/海报与 .nfo：`
  return `${head}\n\n${preview}\n\n确定继续？`
}

/** 整理整个媒体库前的确认文案 */
export const organizeLibraryConfirm = (name: string): string =>
  `整理整个媒体库「${name}」？\n\n` +
  '会把库里所有已刮削的文件按模板搬进子目录，并重新写出封面/海报与 .nfo；\n' +
  '视频文件会被移动，搬空后的目录会被删除。\n\n' +
  '如果只想试一下，建议先到「文件」里对单条点「整理」。确定继续？'

/** 从文件路径取文件名作为播放标题 */
export const playTitle = (path: string): string =>
  path.split(/[\\/]/).pop() || '正在播放'
