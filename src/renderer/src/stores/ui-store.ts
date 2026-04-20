/**
 * UI 状态 Store
 * 管理弹窗、加载状态等 UI 相关状态
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '@/types'

export const useUIStore = defineStore('ui', () => {
  // 搜索结果弹窗状态
  const showSearchModal = ref(false)
  const searchMovies = ref<Movie[]>([])
  const currentScrapeItem = ref<ProcessedItem | null>(null)

  // 手动匹配弹窗状态
  const showManualScrapeModal = ref(false)

  // 队列管理弹窗状态
  const showQueueModal = ref(false)

  // 左侧面板宽度
  const leftPanelWidth = ref(300)

  // ========== 搜索结果弹窗 ==========

  /**
   * 显示搜索结果弹窗
   */
  const showSearchModalWith = (movies: Movie[], item?: ProcessedItem): void => {
    searchMovies.value = movies
    if (item) {
      currentScrapeItem.value = item
    }
    showSearchModal.value = true
  }

  /**
   * 关闭搜索结果弹窗
   */
  const closeSearchModal = (): void => {
    showSearchModal.value = false
    searchMovies.value = []
  }

  // ========== 手动匹配弹窗 ==========

  /**
   * 显示手动匹配弹窗
   */
  const openManualScrapeModal = (item: ProcessedItem): void => {
    currentScrapeItem.value = item
    showManualScrapeModal.value = true
  }

  /**
   * 关闭手动匹配弹窗
   */
  const closeManualScrapeModal = (): void => {
    showManualScrapeModal.value = false
  }

  // ========== 队列管理弹窗 ==========

  /**
   * 显示队列管理弹窗
   */
  const openQueueModal = (): void => {
    showQueueModal.value = true
  }

  /**
   * 关闭队列管理弹窗
   */
  const closeQueueModal = (): void => {
    showQueueModal.value = false
  }

  // ========== 当前刮削项目 ==========

  /**
   * 设置当前刮削项目
   */
  const setCurrentScrapeItem = (item: ProcessedItem | null): void => {
    currentScrapeItem.value = item
  }

  /**
   * 清空当前刮削项目
   */
  const clearCurrentScrapeItem = (): void => {
    currentScrapeItem.value = null
  }

  // ========== 通用方法 ==========

  /**
   * 重置所有弹窗状态
   */
  const resetAllModals = (): void => {
    showSearchModal.value = false
    searchMovies.value = []
    showManualScrapeModal.value = false
    showQueueModal.value = false
    currentScrapeItem.value = null
  }

  return {
    // 状态
    showSearchModal,
    searchMovies,
    currentScrapeItem,
    showManualScrapeModal,
    showQueueModal,
    leftPanelWidth,

    // 方法
    showSearchModalWith,
    closeSearchModal,
    openManualScrapeModal,
    closeManualScrapeModal,
    openQueueModal,
    closeQueueModal,
    setCurrentScrapeItem,
    clearCurrentScrapeItem,
    resetAllModals,
  }
})
