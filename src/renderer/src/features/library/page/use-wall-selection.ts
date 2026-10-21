/**
 * 海报墙多选状态：选区用 shallowRef<Set> + 版本号（海报墙按版本号重算格子），
 * 点击规则见 page-rules.selectionStep。
 */
import { type Ref, type ShallowRef, ref, shallowRef } from 'vue'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import type { PagedList } from '../wall/paged-list'
import { type ActivateModifiers, selectionStep } from './page-rules'

/** 多选状态与操作。 */
export interface WallSelection {
  selection: ShallowRef<Set<number>>
  selectionVersion: Ref<number>
  clearSelection: () => void
  /** 处理一次点击；需要打开详情时调用 open。 */
  activate: (
    index: number,
    item: LibraryItemSummary,
    modifiers: ActivateModifiers,
    open: (itemId: number) => void
  ) => void
}

/** 创建海报墙多选状态。 */
export function useWallSelection(list: PagedList): WallSelection {
  const selection = shallowRef(new Set<number>())
  const selectionVersion = ref(0)
  let anchorIndex = -1

  function commit(next: Set<number>): void {
    selection.value = next
    selectionVersion.value++
  }

  function clearSelection(): void {
    commit(new Set())
    anchorIndex = -1
  }

  function activate(
    index: number,
    item: LibraryItemSummary,
    modifiers: ActivateModifiers,
    open: (itemId: number) => void
  ): void {
    const step = selectionStep(
      selection.value,
      anchorIndex,
      index,
      item,
      modifiers,
      i => list.at(i)
    )
    if (step.kind === 'select') {
      anchorIndex = step.anchor
      commit(step.selection)
      return
    }
    if (step.clear) clearSelection()
    anchorIndex = step.anchor
    open(item.id)
  }

  return { selection, selectionVersion, clearSelection, activate }
}
