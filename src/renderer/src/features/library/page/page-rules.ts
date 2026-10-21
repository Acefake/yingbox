/**
 * 媒体库页面的纯规则：详情路由参数、空状态标题、视图切换标签、媒体库下拉、海报墙多选。
 * 不依赖 Vue，便于单测。
 */
import type {
  LibraryInfo,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import type { WallQueryState } from '../state/query-state'

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

/** 视图切换上「待确认」的标签：有数量时带千分位数字。 */
export function reviewTabLabel(count: number): string {
  return count ? `待确认 ${count.toLocaleString('zh-CN')}` : '待确认'
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
