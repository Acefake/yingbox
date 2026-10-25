/**
 * 海报墙的纯规则：渲染格的构造（快速滚动时推迟图片）、状态角标、动态范围小标、方向键移动、点击修饰键。
 * 不依赖 Vue / DOM，便于单测。
 */
import type { CSSProperties } from 'vue'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import { type SpecBadge, videoRangeSpec } from '@/components/ui/spec-badge'

/** 一个渲染格。 */
export interface Cell {
  key: number | string
  index: number
  item: LibraryItemSummary | undefined
  src: string | null
  badge: string
  rating: string
  /** 动态范围规格标签（与详情同一套映射，见 spec-badge.ts）；SDR 与没探测过为 null */
  range: SpecBadge | null
  selected: boolean
  style: CSSProperties
}

/** 待确认 / 未匹配角标。 */
export const STATE_BADGES: Partial<
  Record<LibraryItemSummary['matchState'], string>
> = {
  review: '待确认',
  unmatched: '未匹配',
}

/** 构造渲染格需要的输入。 */
export interface CellInput {
  start: number
  end: number
  at: (index: number) => LibraryItemSummary | undefined
  offset: (index: number) => { x: number; y: number }
  /** 快速滚动中：只给已经显示过图片的条目 src。 */
  deferImages: boolean
  shown: ReadonlySet<number>
  selected: ReadonlySet<number>
  showStateBadge: boolean
  image: (poster: string | null) => string | null
  rating: (rating: number | null) => string
}

/**
 * 区间 [start, end) 的渲染格；没加载的条目是占位格（key 为 `p<序号>`）。
 */
export function buildCells(input: CellInput): Cell[] {
  const out: Cell[] = []
  for (let index = input.start; index < input.end; index++) {
    const item = input.at(index)
    const { x, y } = input.offset(index)
    out.push({
      key: item ? item.id : `p${index}`,
      index,
      item,
      src:
        item && (!input.deferImages || input.shown.has(item.id))
          ? input.image(item.poster)
          : null,
      badge:
        item && input.showStateBadge
          ? (STATE_BADGES[item.matchState] ?? '')
          : '',
      rating: item ? input.rating(item.rating) : '',
      range: videoRangeSpec(item?.videoRange),
      selected: item ? input.selected.has(item.id) : false,
      style: { transform: `translate3d(${x}px, ${y}px, 0)` },
    })
  }
  return out
}

/** 区间里已加载条目的 id（停止快速滚动时记为「已显示」）。 */
export function loadedIds(
  start: number,
  end: number,
  at: (index: number) => LibraryItemSummary | undefined
): Set<number> {
  const ids = new Set<number>()
  for (let i = start; i < end; i++) {
    const item = at(i)
    if (item) ids.add(item.id)
  }
  return ids
}

/**
 * 方向键 → 目标格序号（夹在 [0, count - 1]）；不是方向键返回 null。
 */
export function arrowTarget(
  key: string,
  index: number,
  columns: number,
  count: number
): number | null {
  const moves: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns,
  }
  const delta = moves[key]
  if (delta === undefined) return null
  return Math.min(count - 1, Math.max(0, index + delta))
}

/** 单击 / 回车的修饰键：Ctrl / ⌘ 切换，Shift 连选。 */
export function clickModifiers(event: {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}): { toggle: boolean; range: boolean; double: boolean } {
  return {
    toggle: event.metaKey || event.ctrlKey,
    range: event.shiftKey,
    double: false,
  }
}
