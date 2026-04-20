import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { FileItem, ProcessedItem } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'

/**
 * 文件管理hook
 */
export const useFileManagement = () => {
  const { safeExecute } = useErrorHandler()

  const fileData = ref<FileItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const dirLoading = ref(false)
  const scanProgress = ref({ found: 0, active: false })

  // 视频文件扩展名
  const videoExtensions = [
    '.mp4',
    '.avi',
    '.mkv',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.m4v',
  ]

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
      console.log('=== 处理独立视频文件 (use-file-management) ===')
      console.log('视频文件路径:', video.path)
      
      // 获取视频文件所在目录的所有文件（支持 Windows 和 Unix 路径）
      const lastSlashIndex = Math.max(video.path.lastIndexOf('/'), video.path.lastIndexOf('\\'))
      const videoDir = video.path.substring(0, lastSlashIndex)
      const separator = video.path.includes('\\') ? '\\' : '/'

      console.log('视频文件目录:', videoDir)
      console.log('路径分隔符:', separator)

      const sameDirectoryFiles = visibleFiles.filter(
        file => {
          const inDirectory = file.path.startsWith(videoDir + separator)
          const noSubdir = file.path.substring(videoDir.length + 1).indexOf(separator) === -1
          console.log(`文件 ${file.name}:`, {
            inDirectory,
            noSubdir,
            path: file.path,
            videoDir: videoDir + separator
          })
          return file.isFile && inDirectory && noSubdir
        }
      )

      console.log(`视频文件 ${video.name} 同目录文件数量:`, sameDirectoryFiles.length)
      console.log(`同目录文件列表:`, sameDirectoryFiles.map(f => f.name))

      // 检测是否已有 NFO、海报和背景图
      const hasNfo = sameDirectoryFiles.some(file => file.name.toLowerCase().endsWith('.nfo'))
      const hasPoster = sameDirectoryFiles.some(file =>
        file.name.toLowerCase().includes('poster') || file.name.toLowerCase() === 'poster.jpg'
      )
      const hasFanart = sameDirectoryFiles.some(file =>
        file.name.toLowerCase().includes('fanart') ||
        file.name.toLowerCase().includes('backdrop') ||
        file.name.toLowerCase() === 'fanart.jpg'
      )

      console.log(`视频文件 ${video.name} 所在目录资源检测:`, { hasNfo, hasPoster, hasFanart })

      result.push({
        name: video.name,
        path: video.path,
        type: 'video',
        size: video.size,
        files: sameDirectoryFiles,
        hasNfo,
        hasPoster,
        hasFanart,
      })
    })

    return result
  }

  /**
   * 读取目录
   */
  const readDirectory = async (): Promise<void> => {
    console.log('=== use-file-management 开始读取目录 ===')
    const result = await safeExecute(
      async () => {
        console.log('打开文件夹选择对话框')
        const dialogResult = await window.api.dialog.openDirectory()
        console.log('文件夹选择结果:', dialogResult)

        if (
          !dialogResult.success ||
          dialogResult.canceled ||
          !dialogResult.filePaths?.length
        ) {
          console.log('用户取消选择或选择失败')
          return null
        }

        const selectedPath = dialogResult.filePaths[0]
        console.log('选中的路径:', selectedPath)
        currentDirectoryPath.value = selectedPath

        console.log('开始递归读取目录文件...')
        scanProgress.value = { found: 0, active: true }
        const files = await window.api.file.readdirRecursive(selectedPath)
        console.log('目录读取结果:', files)

        if (!files.success || !files.data) {
          console.error('读取目录失败:', files.error)
          throw new Error(files.error || '读取目录失败')
        }

        const scannedFiles = files.data as FileItem[]
        console.log('扫描到的文件数量:', scannedFiles.length)
        console.log('文件列表前5个:', scannedFiles.slice(0, 5).map(f => ({ name: f.name, path: f.path })))

        fileData.value = scannedFiles
        scanProgress.value = { found: scannedFiles.length, active: false }
        saveToCache()

        console.log('=== use-file-management 目录读取完成 ===')
        return scannedFiles
      },
      '读取目录失败',
      '成功扫描目录'
    )

    if (result) {
      scanProgress.value.active = false
      message.success(`成功扫描 ${(result as FileItem[]).length} 个文件`)
    }
  }

  /**
   * 刷新文件列表（增量更新）
   */
  const refreshFiles = async (): Promise<void> => {
    if (!currentDirectoryPath.value) {
      const loaded = loadFromCache()
      if (loaded) {
        // 静默加载，不显示提示
      } else {
        message.info('请先添加文件夹')
      }
      return
    }

    try {
      dirLoading.value = true
      scanProgress.value = { found: 0, active: true }

      const files = await window.api.file.readdirRecursive(
        currentDirectoryPath.value
      )

      if (!files.success || !files.data) {
        throw new Error(files.error || '刷新失败')
      }

      const fileList = files.data as FileItem[]
      fileData.value = fileList
      scanProgress.value = { found: fileList.length, active: false }
      saveToCache()

      // 只在文件数量变化较大时显示提示
      const fileCount = fileList.length
      if (fileCount > 0) {
        message.success(`刷新完成：找到 ${fileCount} 个文件`)
      }
    } catch (error) {
      message.error(`刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 增量刷新文件列表（只更新变化的文件）
   */
  const refreshFilesIncremental = async (): Promise<void> => {
    if (!currentDirectoryPath.value) {
      const loaded = loadFromCache()
      if (loaded) {
        // 静默加载，不显示提示
      } else {
        message.info('请先添加文件夹')
      }
      return
    }

    try {
      dirLoading.value = true
      // 移除刷新中的提示，避免频繁提醒

      const files = await window.api.file.readdirRecursive(
        currentDirectoryPath.value
      )

      if (!files.success || !files.data) {
        throw new Error(files.error || '刷新失败')
      }

      const newFiles = files.data as FileItem[]
      const oldFiles = fileData.value

      // 创建旧文件的映射（按路径）
      const oldFileMap = new Map(oldFiles.map(f => [f.path, f]))
      
      // 创建新文件的映射（按路径）
      const newFileMap = new Map(newFiles.map(f => [f.path, f]))

      let addedCount = 0
      let updatedCount = 0
      let removedCount = 0

      // 找出新增和更新的文件
      const updatedFiles: FileItem[] = []
      
      for (const newFile of newFiles) {
        const oldFile = oldFileMap.get(newFile.path) as FileItem | undefined
        
        if (!oldFile) {
          // 新增文件
          updatedFiles.push(newFile)
          addedCount++
        } else if ((oldFile as any).mtime !== (newFile as any).mtime) {
          // 文件已修改
          updatedFiles.push(newFile)
          updatedCount++
        } else {
          // 文件未变化，保留旧文件
          updatedFiles.push(oldFile)
        }
      }

      // 找出删除的文件
      for (const oldFile of oldFiles) {
        if (!newFileMap.has(oldFile.path)) {
          removedCount++
        }
      }

      // 更新文件数据
      fileData.value = updatedFiles
      saveToCache()

      // 只在有实际变化时显示提示
      if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        message.success(`增量刷新完成：新增 ${addedCount}，更新 ${updatedCount}，删除 ${removedCount}`)
      }
    } catch (error) {
      message.error(`增量刷新失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 只刷新特定目录（非递归）
   */
  const refreshSpecificDirectory = async (targetPath: string): Promise<void> => {
    if (!currentDirectoryPath.value) {
      return
    }

    try {
      dirLoading.value = true

      // 统一路径分隔符为正斜杠
      const normalizedTargetPath = targetPath.replace(/\\/g, '/')

      // 只读取目标目录（非递归）
      const files = await window.api.file.readdir(targetPath)

      if (!files.success || !files.data) {
        throw new Error(files.error || '读取目录失败')
      }

      const newFiles = files.data as FileItem[]
      const oldFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        return normalizedPath.startsWith(normalizedTargetPath + '/') || normalizedPath === normalizedTargetPath
      })

      // 创建旧文件的映射（按路径）
      const oldFileMap = new Map(oldFiles.map(f => [f.path, f]))
      
      // 创建新文件的映射（按路径）
      const newFileMap = new Map(newFiles.map(f => [f.path, f]))

      let addedCount = 0
      let updatedCount = 0
      let removedCount = 0

      // 找出新增和更新的文件
      const updatedFiles: FileItem[] = []
      
      for (const newFile of newFiles) {
        const oldFile = oldFileMap.get(newFile.path) as FileItem | undefined
        
        if (!oldFile) {
          // 新增文件
          updatedFiles.push(newFile)
          addedCount++
        } else if ((oldFile as any).mtime !== (newFile as any).mtime) {
          // 文件已修改
          updatedFiles.push(newFile)
          updatedCount++
        } else {
          // 文件未变化，保留旧文件
          updatedFiles.push(oldFile)
        }
      }

      // 找出删除的文件
      for (const oldFile of oldFiles) {
        if (!newFileMap.has(oldFile.path)) {
          removedCount++
        }
      }

      // 更新文件数据：移除目标目录下的旧文件，添加新文件
      const otherFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        return !normalizedPath.startsWith(normalizedTargetPath + '/') && normalizedPath !== normalizedTargetPath
      })
      fileData.value = [...otherFiles, ...updatedFiles]
      saveToCache()

      // 只在有实际变化时显示提示
      if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        message.success(`刷新完成：新增 ${addedCount}，更新 ${updatedCount}，删除 ${removedCount}`)
      }
    } catch (error) {
      message.error(`刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 保存到缓存
   */
  const saveToCache = (): void => {
    try {
      localStorage.setItem(
        'folderContent_fileData',
        JSON.stringify(fileData.value)
      )
      localStorage.setItem(
        'folderContent_currentPath',
        currentDirectoryPath.value
      )
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
    scanProgress,

    // 方法
    isVideoFile,
    isHiddenFile,
    processFiles,
    readDirectory,
    refreshFiles,
    refreshFilesIncremental,
    refreshSpecificDirectory,
    saveToCache,
    loadFromCache,
    clearCache,
    clearCacheAndData,
  }
}
