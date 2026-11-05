/** 页头筛选 / 排序用到的页面状态：文件夹选项与选择、排序字段与方向（改了就记住）。 */
import { type ComputedRef, type WritableComputedRef, computed } from 'vue'

import type { LibrarySection } from '../state/library-section'
import {
  type WallQueryState,
  type WallSort,
  defaultOrder,
  saveSort,
} from '../state/query-state'
import { libraryOptionsFor } from './page-rules'

export interface UseWallControlsReturn {
  libraryOptions: ComputedRef<ReturnType<typeof libraryOptionsFor>>
  /** 0 表示全部文件夹 */
  libraryChoice: WritableComputedRef<number>
  setSort: (value: WallSort) => void
  toggleOrder: () => void
}

export function useWallControls(
  section: LibrarySection,
  state: WallQueryState,
  libraries: () => Parameters<typeof libraryOptionsFor>[0]
): UseWallControlsReturn {
  const libraryOptions = computed(() => libraryOptionsFor(libraries()))
  const libraryChoice = computed({
    get: () => state.libraryId ?? 0,
    set: value => {
      state.libraryId = value ? Number(value) : null
    },
  })

  function setSort(value: WallSort): void {
    state.sort = value
    state.order = defaultOrder(value)
    saveSort(section, state)
  }

  function toggleOrder(): void {
    state.order = state.order === 'asc' ? 'desc' : 'asc'
    saveSort(section, state)
  }

  return { libraryOptions, libraryChoice, setSort, toggleOrder }
}
