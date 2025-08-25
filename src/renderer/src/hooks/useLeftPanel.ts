import { ref, computed } from 'vue'
import type { ProcessedItem } from '../types'

/**
 * 左侧边栏管理hook
 */
export const useLeftPanel = () => {
  // 基础状态
  const selectedIndex = ref(-1)
  const leftPanelWidth = ref(300)

  // 多选相关状态
  const isMultiSelectMode = ref(false)
  const selectedItems = ref<Set<number>>(new Set())
  const selectedItemsData = ref<ProcessedItem[]>([])

  /**
   * 选择项目
   */
  const selectItem = (item: ProcessedItem, index: number): void => {
    if (isMultiSelectMode.value) {
      // 多选模式
      toggleItemSelection(index)
    } else {
      // 单选模式
      selectedIndex.value = index
    }
  }

  /**
   * 切换项目选中状态（多选模式）
   */
  const toggleItemSelection = (index: number): void => {
    if (selectedItems.value.has(index)) {
      selectedItems.value.delete(index)
    } else {
      selectedItems.value.add(index)
    }
    updateSelectedItemsData()
  }

  /**
   * 更新选中项目数据
   */
  const updateSelectedItemsData = (): void => {
    // 这里需要从外部传入processedItems，所以暂时留空
    // 实际使用时会在外部调用
  }

  /**
   * 切换多选模式
   */
  const toggleMultiSelectMode = (): void => {
    isMultiSelectMode.value = !isMultiSelectMode.value
    if (!isMultiSelectMode.value) {
      // 退出多选模式时清空选择
      selectedItems.value.clear()
      selectedItemsData.value = []
    }
  }

  /**
   * 全选/取消全选
   */
  const toggleSelectAll = (processedItems: ProcessedItem[]): void => {
    if (selectedItems.value.size === processedItems.length) {
      // 当前全选，执行取消全选
      selectedItems.value.clear()
    } else {
      // 执行全选
      selectedItems.value.clear()
      processedItems.forEach((_, index) => {
        selectedItems.value.add(index)
      })
    }
    updateSelectedItemsData()
  }

  /**
   * 清空选择
   */
  const clearSelection = (): void => {
    selectedItems.value.clear()
    selectedItemsData.value = []
    selectedIndex.value = -1
  }

  /**
   * 设置选中项目数据（供外部调用）
   */
  const setSelectedItemsData = (data: ProcessedItem[]): void => {
    selectedItemsData.value = data
  }

  return {
    // 状态
    selectedIndex,
    leftPanelWidth,
    isMultiSelectMode,
    selectedItems,
    selectedItemsData,
    
    // 方法
    selectItem,
    toggleItemSelection,
    updateSelectedItemsData,
    toggleMultiSelectMode,
    toggleSelectAll,
    clearSelection,
    setSelectedItemsData,
  }
}

