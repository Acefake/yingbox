/**
 * 媒体库页面的纯规则：详情路由参数、空状态标题与文案、视图切换、工具栏摆放、媒体库选项、海报墙多选。
 * 浏览胶囊与「更多」菜单分组的规则在 browse-rules.ts。
 * 不依赖 Vue，便于单测。
 */
import type {
  LibraryInfo,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import { type LibrarySection, SECTIONS } from '../state/library-section'
import type { WallQueryState } from '../state/query-state'
import type { LibraryView } from './LibraryToolbar.vue'

/** 路由 query 里的 ?item=123 → 条目 id；不是正的安全整数时为 null。 */
export function parseDetailId(raw: unknown): number | null {
  const id = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 海报墙为空时的标题：有搜索词 > 有筛选 > 还没扫描到（动漫等按类型分的页面：还没有这类影片）。 */
export function emptyTitleFor(
  state: Pick<WallQueryState, 'search' | 'filter'> &
    Partial<Pick<WallQueryState, 'browse' | 'genre'>>,
  section?: LibrarySection
): string {
  if (state.search) return `没有找到“${state.search}”`
  if (state.browse === 'watchlist' && state.filter === 'all' && !state.genre)
    return '还没有想看的条目，在详情里点「想看」加进来'
  if (
    state.filter !== 'all' ||
    state.genre ||
    (state.browse ?? 'all') !== 'all'
  )
    return '没有符合筛选条件的条目'
  if (section && SECTIONS[section].category !== 'plain')
    return `还没有识别为${SECTIONS[section].label}的影片`
  return '文件夹里还没有扫描到视频'
}

/** 还没有文件夹时的空状态文案：番号页引导添加番号文件夹，其他页面共用普通片库文件夹。 */
export function noFolderCopy(section: LibrarySection): {
  title: string
  text: string
} {
  if (section === 'jav')
    return {
      title: '添加你的番号文件夹',
      text: '影盒按文件名里的番号（如 ABC-123）刮削番号站点，补全封面、演员和简介，不需要 TMDB 令牌。',
    }
  return {
    title: '添加你的影片文件夹',
    text: '电影、剧集、动漫、综艺放在一起也没关系：影盒会自动识别片名，补全海报、简介和演职员，并分到对应页面。',
  }
}

/** 页头切换：资料库，番号页多一个演员（演员库只属于番号页）。待确认由标题下的提示进入，不在这里。 */
export function viewOptionsFor(
  section: LibrarySection
): SegmentedOption<LibraryView>[] {
  return [
    { value: 'wall', label: '资料库' },
    ...(section === 'jav' ? [{ value: 'actors' as const, label: '演员' }] : []),
  ]
}

/** 页头右侧的操作按钮。 */
export type ToolbarAction = 'scan' | 'identify' | 'visual' | 'video-wall'

/** 工具栏此刻的条件。 */
export interface ToolbarContext {
  view: LibraryView
  hasLibraries: boolean
  /** 海报墙条目数；null 为还不知道 */
  count: number | null
  /** 有分面筛选（番号页） */
  facets: boolean
}

/**
 * 页头右侧的操作按钮（顺序即从左到右）：扫描、识别，海报墙上再有按画面搜（番号页）与视频墙（有条目时）。
 * 排序、匹配状态与类型筛选属于「全部」一段（WallHeader），不在页头；媒体库设置在「设置 → 媒体库」。
 */
export function toolbarActions(ctx: ToolbarContext): ToolbarAction[] {
  if (!ctx.hasLibraries) return []
  const wall = ctx.view === 'wall'
  const actions: ToolbarAction[] = ['scan', 'identify']
  if (wall && ctx.facets) actions.push('visual')
  if (wall && ctx.count) actions.push('video-wall')
  return actions
}

/** 媒体库选项（「更多」里的媒体库分组）：0 表示全部文件夹。 */
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
