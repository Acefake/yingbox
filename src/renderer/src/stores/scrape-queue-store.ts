/**
 * 刮削队列 Store
 * 管理刮削任务队列状态
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { ProcessedItem } from '@/types'

// 刮削任务类型
export interface ScrapeTask {
  item: ProcessedItem
  movie: Movie
}

export const useScrapeQueueStore = defineStore('scrapeQueue', () => {
  // 状态
  const queue = ref<ScrapeTask[]>([])
  const isProcessing = ref(false)
  const currentIndex = ref(0)

  /**
   * 添加刮削任务到队列
   */
  const addToQueue = (item: ProcessedItem, movie: Movie): void => {
    // 检查是否已经在队列中
    const existingIndex = queue.value.findIndex(
      task => task.item.path === item.path
    )

    if (existingIndex >= 0) {
      // 如果已存在，更新电影信息
      queue.value[existingIndex].movie = movie
      message.success(`已更新队列中的 ${item.name}`)
    } else {
      // 添加新任务到队列
      queue.value.push({
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
    if (index >= 0 && index < queue.value.length) {
      // 不允许删除正在处理的任务
      if (isProcessing.value && index === currentIndex.value) {
        message.warning('无法删除正在处理的任务')
        return
      }

      // 不允许删除已完成的任务
      if (isProcessing.value && index < currentIndex.value) {
        message.warning('无法删除已完成的任务')
        return
      }

      const task = queue.value[index]
      queue.value.splice(index, 1)

      // 如果删除的是当前索引之前的任务，需要调整当前索引
      if (isProcessing.value && index < currentIndex.value) {
        currentIndex.value--
      }

      message.success(`已从队列中移除 ${task.item.name}`)

      // 如果队列为空，停止处理
      if (queue.value.length === 0 && isProcessing.value) {
        isProcessing.value = false
        currentIndex.value = 0
        message.info('队列已清空，处理已停止')
      }
    }
  }

  /**
   * 清空刮削队列
   */
  const clearQueue = (): void => {
    if (isProcessing.value) {
      message.warning('请先停止处理再清空队列')
      return
    }

    queue.value = []
    currentIndex.value = 0
    message.success('队列已清空')
  }

  /**
   * 停止处理队列
   */
  const stopProcessing = (): void => {
    if (!isProcessing.value) {
      message.info('队列未在处理中')
      return
    }

    // 停止处理
    isProcessing.value = false

    // 移除已完成的任务，保留未处理的任务
    const remainingTasks = queue.value.slice(currentIndex.value + 1)
    queue.value = remainingTasks
    currentIndex.value = 0

    message.destroy()
    message.success(
      `队列处理已停止，剩余 ${remainingTasks.length} 个未处理任务`
    )
  }

  /**
   * 开始处理
   */
  const startProcessing = (): void => {
    isProcessing.value = true
    currentIndex.value = 0
  }

  /**
   * 完成当前任务，移动到下一个
   */
  const completeCurrentTask = (): void => {
    currentIndex.value++
  }

  /**
   * 处理完成，重置状态
   */
  const finishProcessing = (): void => {
    queue.value = []
    currentIndex.value = 0
    isProcessing.value = false
  }

  /**
   * 检查队列状态一致性
   */
  const checkQueueStateConsistency = (): void => {
    // 如果标记为处理中但队列为空，重置处理状态
    if (isProcessing.value && queue.value.length === 0) {
      isProcessing.value = false
      currentIndex.value = 0
    }

    // 如果当前队列索引超出范围，重置索引和处理状态
    if (currentIndex.value >= queue.value.length) {
      currentIndex.value = 0
      isProcessing.value = false
    }
  }

  /**
   * 获取当前任务
   */
  const currentTask = (): ScrapeTask | null => {
    if (currentIndex.value < queue.value.length) {
      return queue.value[currentIndex.value]
    }
    return null
  }

  /**
   * 是否还有更多任务
   */
  const hasMoreTasks = (): boolean => {
    return currentIndex.value < queue.value.length
  }

  return {
    // 状态
    queue,
    isProcessing,
    currentIndex,

    // 方法
    addToQueue,
    removeFromQueue,
    clearQueue,
    stopProcessing,
    startProcessing,
    completeCurrentTask,
    finishProcessing,
    checkQueueStateConsistency,
    currentTask,
    hasMoreTasks,
  }
})
