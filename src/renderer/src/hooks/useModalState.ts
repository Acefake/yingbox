import { ref } from 'vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '../types'

/**
 * 弹窗状态管理hook
 */
export const useModalState = () => {
  // 搜索结果弹窗
  const showSearchModal = ref(false)
  const searchMovies = ref<Movie[]>([])
  const currentScrapeItem = ref<ProcessedItem | null>(null)

  // 手动匹配弹窗
  const showManualScrapeModal = ref(false)

  // 刮削队列管理弹窗
  const showQueueModal = ref(false)

  /**
   * 显示搜索结果弹窗
   */
  const handleShowSearchModal = (movies: Movie[], item?: ProcessedItem): void => {
    searchMovies.value = movies
    if (item) {
      currentScrapeItem.value = item
    }
    showSearchModal.value = true
  }

  /**
   * 关闭搜索结果弹窗
   */
  const handleCloseSearchModal = (): void => {
    showSearchModal.value = false
    searchMovies.value = []
    // 注意：不在这里清空currentScrapeItem，因为可能还需要用到
  }

  /**
   * 显示手动匹配弹窗
   */
  const handleShowManualScrapeModal = (item: ProcessedItem): void => {
    currentScrapeItem.value = item
    showManualScrapeModal.value = true
  }

  /**
   * 关闭手动匹配弹窗
   */
  const handleCloseManualScrapeModal = (): void => {
    showManualScrapeModal.value = false
    // 注意：不在这里清空currentScrapeItem，因为可能还需要用到
  }

  /**
   * 显示队列管理弹窗
   */
  const handleShowQueueModal = (): void => {
    showQueueModal.value = true
  }

  /**
   * 关闭队列管理弹窗
   */
  const handleCloseQueueModal = (): void => {
    showQueueModal.value = false
  }

  /**
   * 清空当前刮削项目
   */
  const clearCurrentScrapeItem = (): void => {
    currentScrapeItem.value = null
  }

  /**
   * 设置当前刮削项目
   */
  const setCurrentScrapeItem = (item: ProcessedItem | null): void => {
    currentScrapeItem.value = item
  }

  return {
    // 状态
    showSearchModal,
    searchMovies,
    showManualScrapeModal,
    currentScrapeItem,
    showQueueModal,
    
    // 方法
    handleShowSearchModal,
    handleCloseSearchModal,
    handleShowManualScrapeModal,
    handleCloseManualScrapeModal,
    handleShowQueueModal,
    handleCloseQueueModal,
    clearCurrentScrapeItem,
    setCurrentScrapeItem,
  }
}
