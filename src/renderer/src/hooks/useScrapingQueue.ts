import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '../types'
import { useErrorHandler } from './useErrorHandler'

// 定义刮削任务类型
interface ScrapeTask {
  item: ProcessedItem
  movie: Movie
}

/**
 * 刮削队列管理hook
 */
export const useScrapingQueue = () => {
  const { safeExecute } = useErrorHandler()
  
  const scrapeQueue = ref<ScrapeTask[]>([])
  const isProcessingQueue = ref(false)
  const currentQueueIndex = ref(0)

  /**
   * 添加刮削任务到队列
   */
  const addToQueue = (item: ProcessedItem, movie: Movie): void => {
    // 检查是否已经在队列中
    const existingIndex = scrapeQueue.value.findIndex(
      task => task.item.path === item.path
    )

    if (existingIndex >= 0) {
      // 如果已存在，更新电影信息
      scrapeQueue.value[existingIndex].movie = movie
      message.success(`已更新队列中的 ${item.name}`)
    } else {
      // 添加新任务到队列
      scrapeQueue.value.push({
        item: { ...item },
        movie: { ...movie },
      })
      message.success(`已添加 ${item.name} 到刮削队列`)
    }
  }

  /**
   * 从队列中移除任务
   */
  const removeFromQueue = (index: number): void => {
    if (index >= 0 && index < scrapeQueue.value.length) {
      // 不允许删除正在处理的任务
      if (isProcessingQueue.value && index === currentQueueIndex.value) {
        message.warning('无法删除正在处理的任务')
        return
      }

      // 不允许删除已完成的任务
      if (isProcessingQueue.value && index < currentQueueIndex.value) {
        message.warning('无法删除已完成的任务')
        return
      }

      const task = scrapeQueue.value[index]
      scrapeQueue.value.splice(index, 1)

      // 如果删除的是当前索引之前的任务，需要调整当前索引
      if (isProcessingQueue.value && index < currentQueueIndex.value) {
        currentQueueIndex.value--
      }

      message.success(`已从队列中移除 ${task.item.name}`)

      // 如果队列为空，停止处理
      if (scrapeQueue.value.length === 0 && isProcessingQueue.value) {
        isProcessingQueue.value = false
        currentQueueIndex.value = 0
        message.info('队列已清空，处理已停止')
      }
    }
  }

  /**
   * 清空刮削队列
   */
  const clearQueue = (): void => {
    if (isProcessingQueue.value) {
      message.warning('请先停止处理再清空队列')
      return
    }

    scrapeQueue.value = []
    currentQueueIndex.value = 0
    message.success('队列已清空')
  }

  /**
   * 停止处理队列
   */
  const stopProcessing = (): void => {
    if (!isProcessingQueue.value) {
      message.info('队列未在处理中')
      return
    }

    // 停止处理
    isProcessingQueue.value = false

    // 移除已完成的任务，保留未处理的任务
    const remainingTasks = scrapeQueue.value.slice(currentQueueIndex.value + 1)
    scrapeQueue.value = remainingTasks
    currentQueueIndex.value = 0

    message.destroy()
    message.success(`队列处理已停止，剩余 ${remainingTasks.length} 个未处理任务`)
  }

  /**
   * 检查队列状态一致性
   */
  const checkQueueStateConsistency = (): void => {
    // 如果标记为处理中但队列为空，重置处理状态
    if (isProcessingQueue.value && scrapeQueue.value.length === 0) {
      isProcessingQueue.value = false
      currentQueueIndex.value = 0
    }

    // 如果当前队列索引超出范围，重置索引和处理状态
    if (currentQueueIndex.value >= scrapeQueue.value.length) {
      currentQueueIndex.value = 0
      isProcessingQueue.value = false
    }
  }

  return {
    // 状态
    scrapeQueue,
    isProcessingQueue,
    currentQueueIndex,
    
    // 方法
    addToQueue,
    removeFromQueue,
    clearQueue,
    stopProcessing,
    checkQueueStateConsistency,
  }
}

