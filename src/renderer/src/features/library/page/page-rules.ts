/**
 * 媒体库页面的纯规则：详情路由参数、空状态标题与文案、视图切换、媒体库下拉、海报墙多选。
 * 不依赖 Vue，便于单测。
 */
import type {
  LibraryInfo,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import type { LibrarySection } from '../state/library-section'
import type { WallQueryState } from '../state/query-state'
import type { LibraryView } from './LibraryToolbar.vue'

/** 路由 query 里的 ?item=123 → 条目 id；不是正的安全整数时为 null。 */
export function parseDetailId(raw: unknown): number | null {
  const id = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 海报墙为空时的标题：有搜索词 > 有筛选 > 还没扫描到。 */
export function emptyTitleFor(
  state: Pick<WallQueryState, 'search' | 'filter'>
): string {
  if (state.search) return `没有找到“${state.search}”`
  if (state.filter !== 'all') return '没有符合筛选条件的条目'
  return '文件夹里还没有扫描到视频'
}

/** 还没有文件夹时的空状态文案：番号页引导添加番号文件夹。 */
export function noFolderCopy(section: LibrarySection): {
  title: string
  text: string
} {
  if (section === 'jav')
    return {
      title: '添加你的番号文件夹',
      text: '影盒按文件名里的番号（如 ABC-123）刮削番号站点，补全封面、演员和简介，不需要 TMDB 令牌。',
    }
  const label = section === 'movie' ? '电影' : '剧集'
  return {
    title: `添加你的${label}文件夹`,
    text: '影盒会扫描文件夹里的视频，自动识别片名并补全海报、简介和演职员。',
  }
}

/** 「待确认」筛选胶囊上的数量：0 时不显示，其余带千分位。 */
export function reviewChipCount(count: number): string | undefined {
  return count ? count.toLocaleString('zh-CN') : undefined
}

/** 页头切换：资料库，番号页多一个演员（演员库只属于番号页）。待确认是筛选胶囊，不在这里。 */
export function viewOptionsFor(
  section: LibrarySection
): SegmentedOption<LibraryView>[] {
  return [
    { value: 'wall', label: '资料库' },
    ...(section === 'jav' ? [{ value: 'actors' as const, label: '演员' }] : []),
  ]
}

/** 工具栏操作。 */
export type ToolbarAction =
  | 'sort'
  | 'order'
  | 'facets'
  | 'visual'
  | 'tonight'
  | 'video-wall'
  | 'scan'
  | 'identify'
  | 'settings'

/** 工具栏此刻的条件。 */
export interface ToolbarContext {
  view: LibraryView
  hasLibraries: boolean
  /** 海报墙条目数；null 为还不知道 */
  count: number | null
  /** 有分面筛选（番号页） */
  facets: boolean
  /** 有「今晚看什么」（电影 / 剧集页） */
  tonight: boolean
}

/**
 * 工具栏操作的摆放：常用的直接排在页头（图标 + 文字），其余收进「更多」。
 * 最小窗口（1200 宽、侧栏展开）下页头一行放得下标题、排序、升降、筛选、扫描、识别和「更多」。
 */
export function toolbarActions(ctx: ToolbarContext): {
  inline: ToolbarAction[]
  more: ToolbarAction[]
} {
  const wall = ctx.hasLibraries && ctx.view === 'wall'
  const inline: ToolbarAction[] = []
  const more: ToolbarAction[] = []
  if (wall) inline.push('sort', 'order')
  if (wall && ctx.facets) inline.push('facets')
  if (ctx.hasLibraries) inline.push('scan', 'identify')
  if (wall && ctx.facets) more.push('visual')
  if (ctx.hasLibraries && ctx.tonight) more.push('tonight')
  if (wall && ctx.count) more.push('video-wall')
  more.push('settings')
  return { inline, more }
}

/** 媒体库下拉：0 表示全部文件夹。 */
export function libraryOptionsFor(
  libraries: Pick<LibraryInfo, 'id' | 'name'>[]
): Array<{ value: number; label: string }> {
  return [
    { value: 0, label: '全部文件夹' },
    ...libraries.map(lib => ({ value: lib.id, label: lib.name })),
  ]
}

/** 海报墙点击的修饰键。 */
export interface ActivateModifiers {
  toggle: boolean
  range: boolean
  double: boolean
}

/** 一次点击后的多选结果。 */
export type SelectionStep =
  /** 选区变了（anchor 为新的锚点）。 */
  | { kind: 'select'; selection: Set<number>; anchor: number }
  /** 打开详情；clear 为 true 时先清空选区。 */
  | { kind: 'open'; clear: boolean; anchor: number }

/**
 * 海报墙多选：Shift 从锚点连选到当前格（锚点不变，跳过还没加载的格），
 * Ctrl / ⌘ 切换当前格并把锚点移过来，普通单击打开详情（有选区时先清空，双击不清空）。
 *
 * @param at 按序号取已加载的条目
 */
export function selectionStep(
  selection: ReadonlySet<number>,
  anchor: number,
  index: number,
  item: Pick<LibraryItemSummary, 'id'>,
  modifiers: ActivateModifiers,
  at: (index: number) => Pick<LibraryItemSummary, 'id'> | undefined
): SelectionStep {
  if (modifiers.range && anchor >= 0) {
    const next = new Set(selection)
    const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)]
    for (let i = from; i <= to; i++) {
      const it = at(i)
      if (it) next.add(it.id)
    }
    return { kind: 'select', selection: next, anchor }
  }
  if (modifiers.toggle) {
    const next = new Set(selection)
    if (next.has(item.id)) next.delete(item.id)
    else next.add(item.id)
    return { kind: 'select', selection: next, anchor: index }
  }
  return {
    kind: 'open',
    clear: selection.size > 0 && !modifiers.double,
    anchor: index,
  }
}
