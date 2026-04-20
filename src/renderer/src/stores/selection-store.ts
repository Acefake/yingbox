/**
 * 选择状态 Store
 * 管理文件选择、多选模式等状态
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProcessedItem } from '@/types'
import { useFileStore } from '@/stores/file-store'

export const useSelectionStore = defineStore('selection', () => {
  // 状态
  const selectedIndex = ref(-1)
  const selectedItem = ref<ProcessedItem | null>(null)
  const isMultiSelectMode = ref(false)
  const selectedIndices = ref<Set<number>>(new Set())

  // 计算属性：选中的项目数据列表
  const selectedItemsData = computed((): ProcessedItem[] => {
    const fileStore = useFileStore()
    return Array.from(selectedIndices.value)
      .map(index => fileStore.processedItems[index])
      .filter(Boolean)
  })

  // 计算属性：选中项目数量
  const selectedCount = computed((): number => {
    return selectedIndices.value.size
  })

  /**
   * 选择单个项目
   */
  const selectItem = (item: ProcessedItem, index: number): void => {
    if (isMultiSelectMode.value) {
      // 多选模式
      toggleItemSelection(item, index)
    } else {
      // 单选模式
      selectedItem.value = item
      selectedIndex.value = index
    }
  }

  /**
   * 切换项目选择状态（多选模式）
   */
  const toggleItemSelection = (_item: ProcessedItem, index: number): void => {
    if (selectedIndices.value.has(index)) {
      selectedIndices.value.delete(index)
    } else {
      selectedIndices.value.add(index)
    }
  }

  /**
   * 切换多选模式
   */
  const toggleMultiSelectMode = (): void => {
    isMultiSelectMode.value = !isMultiSelectMode.value
    if (!isMultiSelectMode.value) {
      // 退出多选模式时清空选择
      clearMultiSelection()
    }
  }

  /**
   * 全选
   */
  const selectAll = (): void => {
    const fileStore = useFileStore()
    selectedIndices.value.clear()
    fileStore.processedItems.forEach((_, index) => {
      selectedIndices.value.add(index)
    })
  }

  /**
   * 取消全选
   */
  const deselectAll = (): void => {
    selectedIndices.value.clear()
  }

  /**
   * 切换全选状态
   */
  const toggleSelectAll = (): void => {
    const fileStore = useFileStore()
    if (selectedIndices.value.size === fileStore.processedItems.length) {
      // 当前全选，执行取消全选
      deselectAll()
    } else {
      // 执行全选
      selectAll()
    }
  }

  /**
   * 清空多选
   */
  const clearMultiSelection = (): void => {
    selectedIndices.value.clear()
  }

  /**
   * 清空所有选择状态
   */
  const clearSelection = (): void => {
    selectedIndex.value = -1
    selectedItem.value = null
    selectedIndices.value.clear()
    isMultiSelectMode.value = false
  }

  /**
   * 同步更新 selectedItem（在文件列表刷新后调用）
   */
  const syncSelectedItem = (): void => {
    const fileStore = useFileStore()
    if (
      selectedIndex.value >= 0 &&
      selectedIndex.value < fileStore.processedItems.length
    ) {
      selectedItem.value = fileStore.processedItems[selectedIndex.value]
    }
  }

  /**
   * 检查项目是否被选中
   */
  const isItemSelected = (index: number): boolean => {
    if (isMultiSelectMode.value) {
      return selectedIndices.value.has(index)
    }
    return selectedIndex.value === index
  }

  return {
    // 状态
    selectedIndex,
    selectedItem,
    isMultiSelectMode,
    selectedIndices,
    selectedItemsData,
    selectedCount,

    // 方法
    selectItem,
    toggleItemSelection,
    toggleMultiSelectMode,
    selectAll,
    deselectAll,
    toggleSelectAll,
    clearMultiSelection,
    clearSelection,
    syncSelectedItem,
    isItemSelected,
  }
})
