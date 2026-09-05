import { readMediaDirectory, fileId as makeId } from '@/utils/media-directory'
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { FileItem, ProcessedItem } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'

/** 基于路径生成确定性 ID（轻量 hash） */

/** 名称排序比较器：文件夹优先，然后按名称字母序 */
const compareItems = (a: ProcessedItem, b: ProcessedItem): number => {
  const aScraped = Boolean(a.hasNfo && a.hasPoster)
  const bScraped = Boolean(b.hasNfo && b.hasPoster)
  if (aScraped !== bScraped) {
    return aScraped ? -1 : 1
  }
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 文件管理hook
 */
export const useFileManagement = () => {
  const { safeExecute } = useErrorHandler()

  const fileData = ref<FileItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const dirLoading = ref(false)
  const scanProgress = ref({ found: 0, active: false })
  let cacheSaveScheduled = false
  let cacheSaveVersion = 0

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
   * 显示所有视频文件，并从视频文件所在的文件夹读取关联数据
   */
  const processFiles = (files: FileItem[]): ProcessedItem[] => {
    if (!files || files.length === 0) return []

    const result: ProcessedItem[] = []

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

    // 构建文件索引：规范化路径 → 文件项，用于 O(1) 查找
    const normFileMap = new Map<string, FileItem[]>()
    for (const f of visibleFiles) {
      if (!f.isFile) continue
      const dir = normPath(f.path).replace(/\/[^/]+$/, '')
      const arr = normFileMap.get(dir)
      if (arr) arr.push(f)
      else normFileMap.set(dir, [f])
    }
    const directoryMediaState = new Map<
      string,
      { hasNfo: boolean; hasPoster: boolean; hasFanart: boolean }
    >()

    // 显示所有视频文件，从视频文件所在的文件夹读取关联数据
    for (const file of visibleFiles) {
      if (!file.isFile || !isVideoFile(file.name)) continue

      // 获取视频文件所在目录
      const lastSlashIndex = Math.max(
        file.path.lastIndexOf('/'),
        file.path.lastIndexOf('\\')
      )
      const videoDir = file.path.substring(0, lastSlashIndex)
      const normVideoDir = normPath(videoDir)

      // 从索引中获取同目录文件
      const sameDirectoryFiles = normFileMap.get(normVideoDir) || []
      let mediaState = directoryMediaState.get(normVideoDir)
      if (!mediaState) {
        mediaState = {
          hasNfo: sameDirectoryFiles.some(f =>
            f.name.toLowerCase().endsWith('.nfo')
          ),
          hasPoster: sameDirectoryFiles.some(f =>
            f.name.toLowerCase().includes('poster') ||
            f.name.toLowerCase() === 'poster.jpg'
          ),
          hasFanart: sameDirectoryFiles.some(
            f =>
              f.name.toLowerCase().includes('fanart') ||
              f.name.toLowerCase().includes('backdrop') ||
              f.name.toLowerCase() === 'fanart.jpg'
          ),
        }
        directoryMediaState.set(normVideoDir, mediaState)
      }

      result.push({
        id: makeId(file.path),
        name: file.name,
        path: file.path,
        type: 'video',
        size: file.size,
        files: sameDirectoryFiles,
        hasNfo: mediaState.hasNfo,
        hasPoster: mediaState.hasPoster,
        hasFanart: mediaState.hasFanart,
      })
    }

    result.sort(compareItems)
    return result
  }

  /**
   * 递归读取目录（自定义实现，支持增量更新进度）
   */
  const readDirectoryRecursive = async (dirPath: string): Promise<FileItem[]> => {
    const files = await readMediaDirectory(dirPath)
    scanProgress.value.found = files.length
    return files
  }

  /**
   * 读取目录
   */
  const readDirectory = async (): Promise<void> => {
    dirLoading.value = true
    scanProgress.value = { found: 0, active: true }
    await safeExecute(async () => {
      const dialogResult = await window.api.dialog.openDirectory()

      if (
        !dialogResult.success ||
        dialogResult.canceled ||
        !dialogResult.filePaths?.length
      ) {
        return null
      }

      const selectedPath = dialogResult.filePaths[0]

      scanProgress.value = { found: 0, active: true }
      const files = await readDirectoryRecursive(selectedPath)
      currentDirectoryPath.value = selectedPath
      fileData.value = files
      scanProgress.value = { found: files.length, active: false }
      saveToCache()

      return files
    }, '读取目录失败')

    scanProgress.value.active = false
    dirLoading.value = false
  }

  /**
   * 刷新文件列表
   * - 有缓存数据时：增量刷新（递归扫描并按路径及 mtime/size 复用未变化条目）
   * - 无缓存数据时：全量扫描
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

    // 有数据时走增量刷新
    if (fileData.value.length > 0) {
      return refreshFilesIncremental()
    }

    // 无数据时全量扫描
    try {
      dirLoading.value = true
      scanProgress.value = { found: 0, active: true }

      const fileList = await readDirectoryRecursive(currentDirectoryPath.value)

      fileData.value = fileList
      scanProgress.value = { found: fileList.length, active: false }
      saveToCache()

      const fileCount = fileList.length
      if (fileCount > 0) {
        message.success(`刷新完成：找到 ${fileCount} 个文件`)
      }
    } catch (error) {
      message.error(
        `刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    } finally {
      scanProgress.value.active = false
      dirLoading.value = false
    }
  }

  /**
   * 增量刷新文件列表（基于 ID + mtime/size 只更新变化的文件）
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

      const newFiles = await readDirectoryRecursive(currentDirectoryPath.value)
      const oldFiles = fileData.value

      // 按 ID 索引旧文件（O(1) 查找）
      const oldById = new Map(oldFiles.map(f => [f.id, f]))

      let addedCount = 0
      let updatedCount = 0
      let removedCount = 0

      // 用同一引用的对象替换变化的项，保留未变化的旧引用（减少 Vue 重渲染）
      const result: FileItem[] = new Array(newFiles.length)
      for (let i = 0; i < newFiles.length; i++) {
        const nf = newFiles[i]
        const of_ = oldById.get(nf.id)
        if (!of_) {
          result[i] = nf
          addedCount++
        } else if (of_.mtime !== nf.mtime || of_.size !== nf.size) {
          result[i] = nf
          updatedCount++
        } else {
          result[i] = of_ // 保留旧引用，Vue 不触发重渲染
        }
      }

      removedCount = oldById.size - newFiles.length + addedCount

      fileData.value = result
      saveToCache()

      if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        message.success(
          `增量刷新完成：新增 ${addedCount}，更新 ${updatedCount}，删除 ${removedCount}`
        )
      }
    } catch (error) {
      message.error(
        `增量刷新失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    } finally {
      scanProgress.value.active = false
      dirLoading.value = false
    }
  }

  /**
   * 只刷新特定目录（非递归，但构建完整路径）
   */
  const refreshSpecificDirectory = async (
    targetPath: string
  ): Promise<void> => {
    if (!currentDirectoryPath.value) {
      return
    }

    try {
      dirLoading.value = true

      // 统一路径分隔符为正斜杠，用于 fileData 过滤比较
      const normalizedTargetPath = targetPath.replace(/\\/g, '/')

      const result = await window.api.file.scanMediaDirectory(targetPath)

      if (!result.success || !result.data) {
        throw new Error(result.error || '读取目录失败')
      }

      const newFiles = (result.data as Omit<FileItem, 'id'>[])
        .map(file => ({ ...file, id: makeId(file.path) }))
        .filter(file => {
          const relativePath = file.path
            .replace(/\\/g, '/')
            .slice(normalizedTargetPath.length + 1)
          return !relativePath.includes('/')
        })

      // 旧文件中属于该目录直接子项的条目（不含更深层子目录中的文件）
      const oldDirFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return false
        // 只匹配直接子项（路径中没有额外的分隔符）
        const relativePart = normalizedPath.slice(
          normalizedTargetPath.length + 1
        )
        return !relativePart.includes('/')
      })

      const oldCount = oldDirFiles.length
      const newCount = newFiles.length

      // 移除旧的直接子项，插入新的
      const otherFiles = fileData.value.filter(f => {
        const normalizedPath = f.path.replace(/\\/g, '/')
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return true
        const relativePart = normalizedPath.slice(
          normalizedTargetPath.length + 1
        )
        return relativePart.includes('/') // 保留更深层子目录中的文件
      })
      fileData.value = [...otherFiles, ...newFiles]
      saveToCache()

      const diff = newCount - oldCount
      const diffStr = diff > 0 ? `+${diff}` : `${diff}`
      message.success(`刷新完成：${newCount} 个文件 (${diffStr})`)
    } catch (error) {
      message.error(
        `刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    } finally {
      scanProgress.value.active = false
      dirLoading.value = false
    }
  }

  /**
   * 刮削完成后全量刷新，避免局部刷新在根目录场景下产生重复条目
   * @param _folderPath 刮削产生的目标文件夹路径（保留参数签名兼容性）
   */
  let refreshPending: Promise<void> | null = null
  let refreshDirty = false
  const refreshAfterScrape = (_folderPath: string): Promise<void> => {
    refreshDirty = true
    if (!refreshPending) {
      refreshPending = (async () => {
        do {
          await new Promise(resolve => setTimeout(resolve, 100))
          refreshDirty = false
          await refreshFiles()
        } while (refreshDirty)
      })().finally(() => { refreshPending = null })
    }
    return refreshPending
  }

  /**
   * 保存到缓存
   */
  const saveToCache = (): void => {
    if (cacheSaveScheduled) return
    cacheSaveScheduled = true
    const version = cacheSaveVersion
    const persist = () => {
      cacheSaveScheduled = false
      if (version !== cacheSaveVersion) return
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

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(persist, { timeout: 1000 })
    } else {
      window.setTimeout(persist, 0)
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
        const parsed = JSON.parse(cachedData) as FileItem[]
        // 迁移旧缓存：补全缺失的 id
        fileData.value = parsed.map(f => ({ ...f, id: makeId(f.path) }))
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
    cacheSaveVersion++
    cacheSaveScheduled = false
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
