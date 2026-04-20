/**
 * 电影列表管理 Composable
 * 处理文件列表刷新、目录管理
 */
import { message } from 'ant-design-vue'
import { useFileStore } from '@/stores/file-store'
import { useSelectionStore } from '@/stores/selection-store'
import { useScrapeQueueStore } from '@/stores/scrape-queue-store'

export const useMovieList = () => {
  const fileStore = useFileStore()
  const selectionStore = useSelectionStore()
  const scrapeQueueStore = useScrapeQueueStore()

  /**
   * 刷新目录
   * @param targetPath 可选的目标路径
   */
  const refreshDirectory = async (targetPath?: string): Promise<void> => {
    // 检查是否有队列正在处理
    if (scrapeQueueStore.isProcessing) {
      message.warning('刮削队列正在处理中，请稍后再试')
      return
    }

    if (targetPath) {
      await refreshSpecificPath(targetPath)
    } else {
      await fileStore.refreshFiles()
    }
  }

  /**
   * 刷新特定路径
   */
  const refreshSpecificPath = async (targetPath: string): Promise<void> => {
    try {
      // 检查目标路径是否是当前目录或其子目录
      if (targetPath === fileStore.currentDirectoryPath) {
        await fileStore.refreshFiles()
        return
      }

      // 检查目标路径是否在当前目录下
      if (targetPath.startsWith(fileStore.currentDirectoryPath)) {
        await fileStore.refreshFiles()
        message.success(`已刷新路径: ${targetPath}`)
      } else {
        message.info(`目标路径不在当前目录下: ${targetPath}`)
      }
    } catch (error) {
      message.error('刷新失败')
    }
  }

  /**
   * 刷新并同步选中项
   */
  const refreshAndSync = async (): Promise<void> => {
    await fileStore.refreshFiles()
    selectionStore.syncSelectedItem()
  }

  return {
    // 状态从 store 获取
    fileStore,
    selectionStore,
    scrapeQueueStore,

    // 方法
    refreshDirectory,
    refreshSpecificPath,
    refreshAndSync,
  }
}
