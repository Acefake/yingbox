import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { FileItem, ProcessedItem } from '../types'
import { useErrorHandler } from './useErrorHandler'

/**
 * 文件管理hook
 */
export const useFileManagement = () => {
  const { safeExecute } = useErrorHandler()
  
  const fileData = ref<FileItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const dirLoading = ref(false)

  // 视频文件扩展名
  const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']

  /**
   * 判断是否为视频文件
   */
  const isVideoFile = (fileName: string): boolean => {
    return videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext))
  }

  /**
   * 判断是否为隐藏文件
   */
  const isHiddenFile = (fileName: string): boolean => {
    return fileName.startsWith('.') || fileName.startsWith('__')
  }

  /**
   * 处理文件列表，按照规则分组
   */
  const processFiles = (files: FileItem[]): ProcessedItem[] => {
    if (!files || files.length === 0) return []

    const result: ProcessedItem[] = []
    const processedPaths = new Set<string>()

    // 过滤掉隐藏文件
    const visibleFiles = files.filter(file => !isHiddenFile(file.name))

    // 找出所有顶级文件夹
    const allFolders = visibleFiles.filter(f => f.isDirectory)

    const topLevelFolders = allFolders.filter(folder => {
      return !allFolders.some(
        otherFolder =>
          otherFolder.path !== folder.path &&
          folder.path.startsWith(otherFolder.path + '/')
      )
    })

    // 处理顶级文件夹
    topLevelFolders.forEach(folder => {
      const folderFiles = visibleFiles.filter(
        f => f.isFile && f.path.startsWith(folder.path + '/')
      )

      const hasVideoFiles = folderFiles.some(file => isVideoFile(file.name))

      if (folderFiles.length > 0 && hasVideoFiles) {
        result.push({
          name: folder.name,
          path: folder.path,
          type: 'folder',
          fileCount: folderFiles.length,
          files: folderFiles,
        })

        folderFiles.forEach(file => {
          processedPaths.add(file.path)
        })
      }
    })

    // 处理独立的视频文件
    const independentVideoFiles = visibleFiles.filter(
      file =>
        file.isFile && isVideoFile(file.name) && !processedPaths.has(file.path)
    )

    independentVideoFiles.forEach(video => {
      // 获取视频文件所在目录的所有文件
      const videoDir = video.path.substring(0, video.path.lastIndexOf('/'))

      const sameDirectoryFiles = visibleFiles.filter(
        file =>
          file.isFile &&
          file.path.startsWith(videoDir + '/') &&
          file.path.lastIndexOf('/') === videoDir.length
      )

      result.push({
        name: video.name,
        path: video.path,
        type: 'video',
        size: video.size,
        files: sameDirectoryFiles,
      })
    })

    return result
  }

  /**
   * 读取目录
   */
  const readDirectory = async (): Promise<void> => {
    const result = await safeExecute(
      async () => {
        const dialogResult = await window.api.dialog.openDirectory()
        
        if (!dialogResult.success || dialogResult.canceled || !dialogResult.filePaths?.length) {
          return null
        }

        const selectedPath = dialogResult.filePaths[0]
        currentDirectoryPath.value = selectedPath

        const files = await window.api.file.readdirRecursive(selectedPath)
        
        if (!files.success || !files.data) {
          throw new Error(files.error || '读取目录失败')
        }

        fileData.value = files.data as FileItem[]
        saveToCache()
        
        return files.data
      },
      '读取目录失败',
      '成功扫描目录'
    )

    if (result) {
      message.success(`成功扫描 ${(result as FileItem[]).length} 个文件`)
    }
  }

  /**
   * 刷新文件列表
   */
  const refreshFiles = async (): Promise<void> => {
    if (!currentDirectoryPath.value) {
      const loaded = loadFromCache()
      if (loaded) {
        message.success('已从缓存加载数据')
      } else {
        message.info('请先添加文件夹')
      }
      return
    }

    const result = await safeExecute(
      async () => {
        dirLoading.value = true
        message.info('正在刷新文件列表...')

        const files = await window.api.file.readdirRecursive(currentDirectoryPath.value)
        
        if (!files.success || !files.data) {
          throw new Error(files.error || '刷新失败')
        }

        fileData.value = files.data as FileItem[]
        saveToCache()
        
        return files.data
      },
      '刷新目录失败',
      '刷新完成'
    )

    if (result) {
      message.success(`刷新完成：找到 ${(result as FileItem[]).length} 个文件`)
    }
  }

  /**
   * 保存到缓存
   */
  const saveToCache = (): void => {
    try {
      localStorage.setItem('folderContent_fileData', JSON.stringify(fileData.value))
      localStorage.setItem('folderContent_currentPath', currentDirectoryPath.value)
    } catch (error) {
      console.error('保存缓存失败:', error)
    }
  }

  /**
   * 从缓存加载
   */
  const loadFromCache = (): boolean => {
    try {
      const cachedData = localStorage.getItem('folderContent_fileData')
      const cachedPath = localStorage.getItem('folderContent_currentPath')

      if (cachedData && cachedPath) {
        fileData.value = JSON.parse(cachedData) as FileItem[]
        currentDirectoryPath.value = cachedPath
        return true
      }
    } catch (error) {
      console.error('加载缓存失败:', error)
    }
    return false
  }

  /**
   * 清除缓存
   */
  const clearCache = (): void => {
    try {
      localStorage.removeItem('folderContent_fileData')
      localStorage.removeItem('folderContent_currentPath')
    } catch (error) {
      console.error('清除缓存失败:', error)
    }
  }

  /**
   * 清除缓存和数据
   */
  const clearCacheAndData = (): void => {
    clearCache()
    fileData.value = []
    currentDirectoryPath.value = ''
    message.success('缓存和数据已清除')
  }

  return {
    // 状态
    fileData,
    currentDirectoryPath,
    dirLoading,
    
    // 方法
    isVideoFile,
    isHiddenFile,
    processFiles,
    readDirectory,
    refreshFiles,
    saveToCache,
    loadFromCache,
    clearCache,
    clearCacheAndData,
  }
}
