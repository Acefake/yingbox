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

    // 统一路径分隔符为正斜杠，便于比较
    const normPath = (p: string): string => p.replace(/\\/g, '/')

    // 过滤掉隐藏文件，同时去重（全量刷新后 path 唯一）
    const seenPaths = new Set<string>()
    const visibleFiles = files.filter(file => {
      if (isHiddenFile(file.name)) return false
      if (seenPaths.has(file.path)) return false
      seenPaths.add(file.path)
      return true
    })

    // 找出所有顶级文件夹（使用统一路径比较）
    const allFolders = visibleFiles.filter(f => f.isDirectory)

    const topLevelFolders = allFolders.filter(folder => {
      const nFolder = normPath(folder.path)
      return !allFolders.some(
        otherFolder =>
          otherFolder.path !== folder.path &&
          nFolder.startsWith(normPath(otherFolder.path) + '/')
      )
    })

    // 处理顶级文件夹
    topLevelFolders.forEach(folder => {
      const nFolder = normPath(folder.path)
      const folderFiles = visibleFiles.filter(
        f => f.isFile && normPath(f.path).startsWith(nFolder + '/')
      )

      const hasVideoFiles = folderFiles.some(file => isVideoFile(file.name))

      // 无论有没有视频，文件夹内的文件都标记为已处理，防止漏出
      folderFiles.forEach(file => {
        processedPaths.add(file.path)
      })

      if (folderFiles.length > 0 && hasVideoFiles) {
        result.push({
          name: folder.name,
          path: folder.path,
          type: 'folder',
          fileCount: folderFiles.length,
          files: folderFiles,
        })
      }
    })

    // 处理独立的视频文件
    const independentVideoFiles = visibleFiles.filter(
      file =>
        file.isFile && isVideoFile(file.name) && !processedPaths.has(file.path)
    )

    independentVideoFiles.forEach(video => {
      // 获取视频文件所在目录的所有文件（支持 Windows 和 Unix 路径）
      const lastSlashIndex = Math.max(video.path.lastIndexOf('/'), video.path.lastIndexOf('\\'))
      const videoDir = video.path.substring(0, lastSlashIndex)
      const separator = video.path.includes('\\') ? '\\' : '/'

      const sameDirectoryFiles = visibleFiles.filter(
        file => {
          const inDirectory = file.path.startsWith(videoDir + separator)
          const noSubdir = file.path.substring(videoDir.length + 1).indexOf(separator) === -1
          // console.log(`文件 ${file.name}:`, {
          //   inDirectory,
          //   noSubdir,
          //   path: file.path,
          //   videoDir: videoDir + separator
          // })
          return file.isFile && inDirectory && noSubdir
        }
      )

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
   * 递归读取目录（自定义实现，支持增量更新进度）
   */
  const readDirectoryRecursive = async (dirPath: string): Promise<FileItem[]> => {
    const allFiles: FileItem[] = []

    try {
      const result = await window.api.file.readdir(dirPath)
      if (!result.success || !result.data) {
        return allFiles
      }

      const items = result.data as Array<{ name: string; isDirectory: boolean; isFile: boolean }>

      for (const item of items) {
        const fullPath = await window.api.path.join(dirPath, item.name)
        const statResult = await window.api.file.stat(fullPath)

        if (!statResult.success || !statResult.data) {
          continue
        }

        const stat = statResult.data as { size: number; isDirectory: boolean; isFile: boolean }

        scanProgress.value.found++
        allFiles.push({
          name: item.name,
          path: fullPath,
          size: stat.size,
          isDirectory: stat.isDirectory,
          isFile: stat.isFile,
        })

        // 如果是目录，递归读取
        if (item.isDirectory) {
          try {
            const subFiles = await readDirectoryRecursive(fullPath)
            allFiles.push(...subFiles)
          } catch {
            // 跳过无法读取的目录
          }
        }
      }
    } catch {
      // 跳过无法读取的目录
    }

    return allFiles
  }

  /**
   * 读取目录
   */
  const readDirectory = async (): Promise<void> => {
    dirLoading.value = true
    scanProgress.value = { found: 0, active: true }
    const result = await safeExecute(
      async () => {
        const dialogResult = await window.api.dialog.openDirectory()

        if (
          !dialogResult.success ||
          dialogResult.canceled ||
          !dialogResult.filePaths?.length
        ) {
          return null
        }

        const selectedPath = dialogResult.filePaths[0]
        currentDirectoryPath.value = selectedPath

        scanProgress.value = { found: 0, active: true }
        const files = await readDirectoryRecursive(selectedPath)
        fileData.value = files
        scanProgress.value = { found: files.length, active: false }
        saveToCache()

        return files
      },
      '读取目录失败'
    )

    if (result) {
      scanProgress.value.active = false
    }
    dirLoading.value = false
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

      const fileList = await readDirectoryRecursive(currentDirectoryPath.value)

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

      const newFiles = await readDirectoryRecursive(currentDirectoryPath.value)
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
   * 只刷新特定目录（非递归，但构建完整路径）
   */
  const refreshSpecificDirectory = async (targetPath: string): Promise<void> => {
    if (!currentDirectoryPath.value) {
      return
    }

    try {
      dirLoading.value = true

      // 统一路径分隔符为正斜杠，用于 fileData 过滤比较
      const normalizedTargetPath = targetPath.replace(/\\/g, '/')

      // 读取目标目录的直接子项
      const result = await window.api.file.readdir(targetPath)

      if (!result.success || !result.data) {
        throw new Error(result.error || '读取目录失败')
      }

      const items = result.data as Array<{ name: string; isDirectory: boolean; isFile: boolean }>

      // 构建含完整路径的 FileItem 列表（只取当前层，不递归）
      const newFiles: FileItem[] = []
      for (const item of items) {
        const fullPath = await window.api.path.join(targetPath, item.name)
        const statResult = await window.api.file.stat(fullPath)
        if (!statResult.success || !statResult.data) continue
        const stat = statResult.data as { size: number; isDirectory: boolean; isFile: boolean }
        newFiles.push({
          name: item.name,
          path: fullPath,
          size: stat.size,
          isDirectory: stat.isDirectory,
          isFile: stat.isFile,
        })
      }

      // 旧文件中属于该目录直接子项的条目（不含更深层子目录中的文件）
      const oldDirFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return false
        // 只匹配直接子项（路径中没有额外的分隔符）
        const relativePart = normalizedPath.slice(normalizedTargetPath.length + 1)
        return !relativePart.includes('/')
      })

      const oldCount = oldDirFiles.length
      const newCount = newFiles.length

      // 移除旧的直接子项，插入新的
      const otherFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return true
        const relativePart = normalizedPath.slice(normalizedTargetPath.length + 1)
        return relativePart.includes('/') // 保留更深层子目录中的文件
      })
      fileData.value = [...otherFiles, ...newFiles]
      saveToCache()

      const diff = newCount - oldCount
      const diffStr = diff > 0 ? `+${diff}` : `${diff}`
      message.success(`刷新完成：${newCount} 个文件 (${diffStr})`)
    } catch (error) {
      message.error(`刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 刮削完成后全量刷新，避免局部刷新在根目录场景下产生重复条目
   * @param _folderPath 刮削产生的目标文件夹路径（保留参数签名兼容性）
   */
  const refreshAfterScrape = async (_folderPath: string): Promise<void> => {
    await refreshFiles()
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
    refreshAfterScrape,
    saveToCache,
    loadFromCache,
    clearCache,
    clearCacheAndData,
  }
}
