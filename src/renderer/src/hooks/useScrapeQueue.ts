import { ref, computed } from 'vue'
import type { ProcessedItem } from '@/types'

/**
 * 刮削队列管理Hook
 * 
 * 提供刮削队列、批量处理、进度跟踪等功能
 * 包括队列管理、任务调度和状态监控
 */
export const useScrapeQueue = () => {
  // 响应式状态
  const scrapeQueue = ref<ProcessedItem[]>([])
  const isProcessingQueue = ref<boolean>(false)
  const currentQueueIndex = ref<number>(-1)
  const processedCount = ref<number>(0)
  const failedCount = ref<number>(0)
  const queueResults = ref<Array<{ item: ProcessedItem; success: boolean; error?: string }>>([])
  const pauseRequested = ref<boolean>(false)

  /**
   * 添加项目到刮削队列
   * @param items 要添加的项目
   */
  const addToQueue = (items: ProcessedItem | ProcessedItem[]) => {
    const itemsArray = Array.isArray(items) ? items : [items]
    
    // 过滤掉已存在的项目
    const newItems = itemsArray.filter(item => 
      !scrapeQueue.value.some(queueItem => queueItem.path === item.path)
    )
    
    scrapeQueue.value.push(...newItems)
  }

  /**
   * 从队列中移除项目
   * @param item 要移除的项目
   */
  const removeFromQueue = (item: ProcessedItem) => {
    const index = scrapeQueue.value.findIndex(queueItem => queueItem.path === item.path)
    if (index > -1) {
      scrapeQueue.value.splice(index, 1)
      
      // 如果移除的是当前正在处理的项目之前的项目，需要调整索引
      if (index <= currentQueueIndex.value) {
        currentQueueIndex.value--
      }
    }
  }

  /**
   * 清空队列
   */
  const clearQueue = () => {
    if (isProcessingQueue.value) {
      pauseRequested.value = true
    }
    scrapeQueue.value = []
    resetQueueState()
  }

  /**
   * 开始处理队列
   * @param scrapeFunction 刮削函数
   */
  const startProcessing = async (scrapeFunction: (item: ProcessedItem) => Promise<boolean>) => {
    if (scrapeQueue.value.length === 0) {
      console.warn('队列为空，无法开始处理')
      return
    }

    if (isProcessingQueue.value) {
      console.warn('队列正在处理中')
      return
    }

    isProcessingQueue.value = true
    pauseRequested.value = false
    currentQueueIndex.value = 0
    processedCount.value = 0
    failedCount.value = 0
    queueResults.value = []

    try {
      for (let i = 0; i < scrapeQueue.value.length; i++) {
        // 检查是否请求暂停
        if (pauseRequested.value) {
          console.log('队列处理已暂停')
          break
        }

        currentQueueIndex.value = i
        const item = scrapeQueue.value[i]

        try {
          console.log(`正在处理: ${item.name} (${i + 1}/${scrapeQueue.value.length})`)
          
          const success = await scrapeFunction(item)
          
          queueResults.value.push({
            item,
            success
          })

          if (success) {
            processedCount.value++
          } else {
            failedCount.value++
          }

          // 添加延迟以避免API限制
          await delay(1000)
        } catch (error) {
          console.error(`处理项目失败: ${item.name}`, error)
          
          queueResults.value.push({
            item,
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          })
          
          failedCount.value++
        }
      }
    } finally {
      isProcessingQueue.value = false
      currentQueueIndex.value = -1
      
      if (!pauseRequested.value) {
        // 处理完成，清空队列
        scrapeQueue.value = []
      }
    }
  }

  /**
   * 暂停队列处理
   */
  const pauseProcessing = () => {
    if (isProcessingQueue.value) {
      pauseRequested.value = true
    }
  }

  /**
   * 恢复队列处理
   * @param scrapeFunction 刮削函数
   */
  const resumeProcessing = async (scrapeFunction: (item: ProcessedItem) => Promise<boolean>) => {
    if (!pauseRequested.value || scrapeQueue.value.length === 0) {
      return
    }

    // 从暂停的位置继续
    const remainingItems = scrapeQueue.value.slice(currentQueueIndex.value)
    scrapeQueue.value = remainingItems
    
    await startProcessing(scrapeFunction)
  }

  /**
   * 重置队列状态
   */
  const resetQueueState = () => {
    currentQueueIndex.value = -1
    processedCount.value = 0
    failedCount.value = 0
    queueResults.value = []
    pauseRequested.value = false
  }

  /**
   * 获取队列统计信息
   */
  const getQueueStats = () => {
    return {
      total: scrapeQueue.value.length,
      processed: processedCount.value,
      failed: failedCount.value,
      remaining: scrapeQueue.value.length - processedCount.value - failedCount.value,
      progress: scrapeQueue.value.length > 0 
        ? Math.round(((processedCount.value + failedCount.value) / scrapeQueue.value.length) * 100)
        : 0
    }
  }

  /**
   * 获取当前处理的项目
   */
  const getCurrentItem = (): ProcessedItem | null => {
    if (currentQueueIndex.value >= 0 && currentQueueIndex.value < scrapeQueue.value.length) {
      return scrapeQueue.value[currentQueueIndex.value]
    }
    return null
  }

  /**
   * 检查项目是否在队列中
   * @param item 要检查的项目
   */
  const isInQueue = (item: ProcessedItem): boolean => {
    return scrapeQueue.value.some(queueItem => queueItem.path === item.path)
  }

  /**
   * 移动队列中项目的位置
   * @param fromIndex 源索引
   * @param toIndex 目标索引
   */
  const moveQueueItem = (fromIndex: number, toIndex: number) => {
    if (isProcessingQueue.value) {
      console.warn('队列处理中，无法移动项目')
      return
    }

    if (fromIndex < 0 || fromIndex >= scrapeQueue.value.length ||
        toIndex < 0 || toIndex >= scrapeQueue.value.length) {
      return
    }

    const item = scrapeQueue.value.splice(fromIndex, 1)[0]
    scrapeQueue.value.splice(toIndex, 0, item)
  }

  /**
   * 延迟函数
   * @param ms 延迟毫秒数
   */
  const delay = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 计算属性
  const queueCount = computed(() => scrapeQueue.value.length)
  const hasQueue = computed(() => scrapeQueue.value.length > 0)
  const isIdle = computed(() => !isProcessingQueue.value)
  const isPaused = computed(() => pauseRequested.value)
  const currentProgress = computed(() => {
    const stats = getQueueStats()
    return stats.progress
  })
  const currentItem = computed(() => getCurrentItem())

  return {
    // 状态
    scrapeQueue,
    isProcessingQueue,
    currentQueueIndex,
    processedCount,
    failedCount,
    queueResults,
    pauseRequested,
    
    // 计算属性
    queueCount,
    hasQueue,
    isIdle,
    isPaused,
    currentProgress,
    currentItem,
    
    // 方法
    addToQueue,
    removeFromQueue,
    clearQueue,
    startProcessing,
    pauseProcessing,
    resumeProcessing,
    resetQueueState,
    getQueueStats,
    getCurrentItem,
    isInQueue,
    moveQueueItem
  }
}