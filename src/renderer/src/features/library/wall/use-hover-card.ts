/**
 * 海报悬停详情卡的显隐与数据：悬停满 HOVER_DELAY.show 弹出、离开 HOVER_DELAY.hide 后收起，
 * 指针移到卡片上保持；触屏、多选中不弹。详情按条目取一次 getItem 并缓存（列表换版本时清空）。
 * 监听委托在网格上（pointerover / pointerout），每格不挂监听器。
 */
import { type Ref, onBeforeUnmount, ref, shallowRef } from 'vue'

import type {
  LibraryItemNode,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import { libraryBridge } from '../api/bridge'
import { HOVER_DELAY, hoverCardPosition } from './hover-card-rules'

export interface HoverCardOptions {
  grid: Ref<HTMLElement | null>
  /** 格子序号 → 条目 */
  itemAt: (index: number) => LibraryItemSummary | undefined
  /** 为 true 时不弹（多选中） */
  disabled: () => boolean
}

/** useHoverCard 的返回值。 */
export interface HoverCard {
  /** 正在显示的条目；null 为收起 */
  item: Ref<LibraryItemSummary | null>
  /** 条目详情；还没取到为 null */
  node: Ref<LibraryItemNode | null>
  position: Ref<{ left: number; top: number }>
  hide: () => void
  keep: () => void
  leave: () => void
  invalidate: () => void
  onPointerOver: (event: PointerEvent) => void
  onPointerOut: (event: PointerEvent) => void
}

export function useHoverCard(options: HoverCardOptions): HoverCard {
  const item = shallowRef<LibraryItemSummary | null>(null)
  const node = shallowRef<LibraryItemNode | null>(null)
  const position = ref({ left: 0, top: 0 })
  const cache = new Map<number, LibraryItemNode | null>()
  let showTimer: number | undefined
  let hideTimer: number | undefined
  let pendingCell: HTMLElement | null = null

  const clear = (): void => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
  }

  function hide(): void {
    clear()
    pendingCell = null
    item.value = null
    node.value = null
  }

  async function load(target: LibraryItemSummary): Promise<void> {
    if (cache.has(target.id)) {
      node.value = cache.get(target.id) ?? null
      return
    }
    const detail = await libraryBridge()
      ?.getItem(target.id)
      .catch(() => null)
    cache.set(target.id, detail ?? null)
    if (item.value?.id === target.id) node.value = detail ?? null
  }

  function show(cell: HTMLElement): void {
    const target = options.itemAt(Number(cell.dataset.index))
    if (!target || !cell.isConnected) return
    position.value = hoverCardPosition(cell.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    item.value = target
    node.value = cache.get(target.id) ?? null
    void load(target)
  }

  function onPointerOver(event: PointerEvent): void {
    if (event.pointerType === 'touch' || options.disabled()) return
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.lib-cell')
    if (!cell || cell === pendingCell) {
      if (cell) clearTimeout(hideTimer)
      return
    }
    clear()
    pendingCell = cell
    const current = options.itemAt(Number(cell.dataset.index))
    if (current && item.value?.id === current.id) return
    showTimer = window.setTimeout(() => show(cell), HOVER_DELAY.show)
  }

  function onPointerOut(event: PointerEvent): void {
    const to = event.relatedTarget as HTMLElement | null
    if (to && pendingCell?.contains(to)) return
    clearTimeout(showTimer)
    pendingCell = null
    leave()
  }

  /** 指针离开格子或卡片：稍后收起（期间进入卡片会取消）。 */
  function leave(): void {
    clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      item.value = null
      node.value = null
    }, HOVER_DELAY.hide)
  }

  /** 指针进入卡片：保持显示。 */
  function keep(): void {
    clear()
  }

  /** 列表换版本（重新识别、换查询）：详情缓存作废。 */
  function invalidate(): void {
    cache.clear()
  }

  onBeforeUnmount(hide)

  return {
    item,
    node,
    position,
    hide,
    keep,
    leave,
    invalidate,
    onPointerOver,
    onPointerOut,
  }
}
