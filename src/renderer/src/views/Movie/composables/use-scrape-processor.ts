/**
 * 刮削处理器 Composable
 * 处理刮削队列执行逻辑
 */
import { message } from 'ant-design-vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { useFileStore } from '@/stores/file-store'
import { useSelectionStore } from '@/stores/selection-store'
import { useScrapeQueueStore } from '@/stores/scrape-queue-store'
import { useUIStore } from '@/stores/ui-store'
import { useScraping } from '@/views/movie/composables/use-scraping'
import { useScrapingTask } from '@/views/movie/composables/use-scrapingTask'

export const useScrapeProcessor = () => {
  const fileStore = useFileStore()
  const selectionStore = useSelectionStore()
  const queueStore = useScrapeQueueStore()
  const uiStore = useUIStore()
  const { searchMovieInfo } = useScraping()
  const { processSingleScrapeTask } = useScrapingTask()

  /**
   * 开始处理刮削队列
   */
  const startProcessingQueue = async (): Promise<void> => {
    console.log('=== 开始处理刮削队列 ===')
    console.log('队列长度:', queueStore.queue.length)
    console.log('队列是否正在处理:', queueStore.isProcessing)

    if (queueStore.queue.length === 0) {
      message.info('队列为空')
      return
    }

    if (queueStore.isProcessing) {
      message.info('队列正在处理中')
      return
    }

    try {
      queueStore.startProcessing()
      console.log('队列处理状态已设置为 true')
      message.loading(
        `开始处理刮削队列，共 ${queueStore.queue.length} 个任务...`,
        0
      )

      console.log('开始处理队列中的第一个任务')
      await processNextQueueItem()
    } catch (error) {
      message.destroy()
      console.error('处理队列失败:', error)
      message.error(
        `处理队列失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    } finally {
      queueStore.stopProcessing()
      uiStore.clearCurrentScrapeItem()
      console.log('队列处理完成，状态已重置')
    }
  }

  /**
   * 处理队列中的下一个项目
   */
  const processNextQueueItem = async (): Promise<void> => {
    console.log('=== 处理队列中的下一个项目 ===')
    console.log('当前索引:', queueStore.currentIndex)
    console.log('队列长度:', queueStore.queue.length)
    console.log('是否有更多任务:', queueStore.hasMoreTasks())
    console.log('是否正在处理:', queueStore.isProcessing)

    // 检查是否还有待处理的任务
    if (!queueStore.hasMoreTasks()) {
      // 所有任务处理完成
      console.log('所有任务处理完成')
      message.destroy()
      message.success(
        `队列处理完成！共处理了 ${queueStore.queue.length} 个任务`
      )

      queueStore.finishProcessing()
      uiStore.closeQueueModal()

      // 刷新文件列表并同步
      message.info('正在刷新文件列表...')
      await fileStore.refreshFiles()
      selectionStore.syncSelectedItem()

      // 延迟刷新确保文件系统同步
      setTimeout(async () => {
        message.info('正在同步文件系统...')
        await fileStore.refreshFiles()
        selectionStore.syncSelectedItem()
      }, 2000)
      return
    }

    // 检查处理是否被停止
    if (!queueStore.isProcessing) {
      console.log('队列处理已停止')
      return
    }

    const task = queueStore.currentTask()

    console.log('当前任务:', task)

    if (!task) {
      console.log('任务为空，跳过')
      return
    }

    try {
      console.log('开始处理任务:', task.movie.title)
      message.destroy()
      message.loading(
        `正在处理 ${task.movie.title} (${queueStore.currentIndex + 1}/${queueStore.queue.length})...`,
        0
      )

      uiStore.setCurrentScrapeItem(task.item)
      console.log('准备调用 processSingleScrapeTask')
      await processSingleScrapeTask(task.movie, task.item)
      console.log('processSingleScrapeTask 完成')

      // 刷新文件列表
      message.info('正在同步文件变化...')
      await fileStore.refreshFiles()

      queueStore.completeCurrentTask()

      // 短暂延迟
      await new Promise(resolve => setTimeout(resolve, 500))

      console.log('准备处理下一个任务')
      await processNextQueueItem()
    } catch (error) {
      console.error('处理任务失败:', error)
      message.destroy()
      message.error(
        `处理 ${task.movie.title} 失败: ${error instanceof Error ? error.message : '未知错误'}`
      )

      queueStore.completeCurrentTask()
      await processNextQueueItem()
    }
  }

  /**
   * 批量添加选中项目到刮削队列
   */
  const addSelectedToScrapeQueue = async (): Promise<void> => {
    const selectedItems = selectionStore.selectedItemsData

    if (selectedItems.length === 0) {
      message.warning('请先选择要添加到队列的项目')
      return
    }

    const loadingMessage = message.loading(
      `正在批量搜索电影信息... (0/${selectedItems.length})`,
      0
    )

    let successCount = 0
    let failedCount = 0

    try {
      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i]

        loadingMessage()
        message.loading(
          `正在批量搜索电影信息... (${i + 1}/${selectedItems.length})`,
          0
        )

        const movieName = item.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[[](){}]/g, '')
          .trim()

        const searchedMovie = await searchMovieInfo(item)

        let movieToAdd: Movie

        if (searchedMovie && searchedMovie.length > 0) {
          movieToAdd = searchedMovie[0]
          successCount++
        } else {
          movieToAdd = {
            id: Date.now() + Math.random(),
            title: movieName || item.name,
            overview: `未找到匹配的电影：${movieName || item.name}`,
            release_date: '',
            poster_path: '',
            backdrop_path: '',
            vote_average: 0,
            vote_count: 0,
            genre_ids: [],
            adult: false,
            original_language: 'zh',
            original_title: movieName || item.name,
            popularity: 0,
            video: false,
          }
          failedCount++
        }

        queueStore.addToQueue(item, movieToAdd)
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      message.destroy()

      if (successCount > 0 && failedCount > 0) {
        message.success(
          `批量添加完成：成功匹配 ${successCount} 个，未匹配 ${failedCount} 个项目`
        )
      } else if (successCount > 0) {
        message.success(
          `已批量添加 ${successCount} 个项目到刮削队列，全部匹配成功`
        )
      } else {
        message.warning(
          `已添加 ${selectedItems.length} 个项目到队列，但未找到匹配的电影信息`
        )
      }

      selectionStore.clearMultiSelection()
    } catch (error) {
      message.destroy()
      message.error('批量添加失败，请重试')
    }
  }

  /**
   * 自动刮削
   */
  const handleAutoScrape = async (item: any): Promise<void> => {
    try {
      const movies = await searchMovieInfo(item)

      if (movies && movies.length > 0) {
        uiStore.showSearchModalWith(movies, item)
        message.success(`找到 ${movies.length} 个匹配结果`)
      } else {
        message.warning('未找到匹配的电影信息')
      }
    } catch (error) {
      console.error('自动刮削失败:', error)
      message.error('自动刮削失败')
    }
  }

  /**
   * 处理刮削电影
   */
  const handleScrapeMovie = (movie: Movie): void => {
    if (!uiStore.currentScrapeItem) {
      message.error('没有选中的刮削项目')
      return
    }

    queueStore.addToQueue(uiStore.currentScrapeItem, movie)
    uiStore.closeSearchModal()
    uiStore.clearCurrentScrapeItem()
  }

  /**
   * 重新匹配
   */
  const rematchMovie = (task: any): void => {
    if (queueStore.isProcessing) {
      message.warning('队列处理中，无法重新匹配')
      return
    }

    uiStore.openManualScrapeModal(task.item)
    message.info(`正在为 "${task.item.name}" 重新匹配电影`)
  }

  return {
    // 方法
    startProcessingQueue,
    processNextQueueItem,
    addSelectedToScrapeQueue,
    handleAutoScrape,
    handleScrapeMovie,
    rematchMovie,
  }
}
