import { readMediaDirectory, fileId as makeId } from '@/utils/media-directory'
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import type { FileItem, ProcessedItem } from '@/types'
import { useErrorHandler } from '@/composables/use-error-handler'

/** 名称排序比较器：已刮削优先，文件夹优先，然后按名称字母序 */
const compareItems = (a: ProcessedItem, b: ProcessedItem): number => {
  const aScraped = Boolean(a.hasNfo && a.hasPoster)
  const bScraped = Boolean(b.hasNfo && b.hasPoster)
  if (aScraped !== bScraped) {
    return aScraped ? -1 : 1
  }
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

const parentDir = (p: string): string => {
  const n = normPath(p)
  const idx = n.lastIndexOf('/')
  return idx <= 0 ? '' : n.slice(0, idx)
}

const INDEX_FILE = 'yingbox-movie-library-index.json'

type CompactEntry = {
  path: string
  id: string
  size: number
  mtime: number
  isFile: boolean
  isDirectory: boolean
  name: string
}

/**
 * 文件管理 hook
 */
export const useFileManagement = () => {
  const { safeExecute } = useErrorHandler()

  const fileData = ref<FileItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const dirLoading = ref(false)
  const scanProgress = ref({ found: 0, active: false })
  let cacheSaveScheduled = false
  let cacheSaveVersion = 0
  let indexFilePath: string | null = null

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

  const isVideoFile = (fileName: string): boolean => {
    return videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext))
  }

  const isHiddenFile = (fileName: string): boolean => {
    return fileName.startsWith('.') || fileName.startsWith('__')
  }

  /** folderPath 是否可做局部刷新（非空、在库根之内、且不是库根本身） */
  const canLocalRefresh = (folderPath: string): boolean => {
    const root = currentDirectoryPath.value
    if (!folderPath || !root) return false
    const folder = normPath(folderPath)
    const rootN = normPath(root)
    if (!folder || folder.toLowerCase() === rootN.toLowerCase()) return false
    return folder.toLowerCase().startsWith(rootN.toLowerCase() + '/')
  }

  const toPreviousIndex = (files: FileItem[]) =>
    files.map(f => ({
      path: f.path,
      mtime: f.mtime ?? 0,
      size: f.size ?? 0,
      name: f.name,
      isDirectory: f.isDirectory,
      isFile: f.isFile,
    }))

  /**
   * 处理文件列表，按照规则分组
   */
  const processFiles = (files: FileItem[]): ProcessedItem[] => {
    if (!files || files.length === 0) return []

    const result: ProcessedItem[] = []
    const seenPaths = new Set<string>()
    const visibleFiles = files.filter(file => {
      if (isHiddenFile(file.name)) return false
      if (seenPaths.has(file.path)) return false
      seenPaths.add(file.path)
      return true
    })

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

    for (const file of visibleFiles) {
      if (!file.isFile || !isVideoFile(file.name)) continue

      const lastSlashIndex = Math.max(
        file.path.lastIndexOf('/'),
        file.path.lastIndexOf('\\')
      )
      const videoDir = file.path.substring(0, lastSlashIndex)
      const normVideoDir = normPath(videoDir)

      const sameDirectoryFiles = normFileMap.get(normVideoDir) || []
      let mediaState = directoryMediaState.get(normVideoDir)
      if (!mediaState) {
        mediaState = {
          hasNfo: sameDirectoryFiles.some(f =>
            f.name.toLowerCase().endsWith('.nfo')
          ),
          hasPoster: sameDirectoryFiles.some(
            f =>
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

  const readDirectoryRecursive = async (
    dirPath: string,
    previous?: FileItem[]
  ): Promise<FileItem[]> => {
    const files = await readMediaDirectory(
      dirPath,
      previous ? toPreviousIndex(previous) : undefined
    )
    scanProgress.value.found = files.length
    return files
  }

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
   * - 有缓存数据时：真正的增量刷新（主进程按目录 mtime 短路）
   * - 无缓存数据时：全量扫描
   */
  const refreshFiles = async (): Promise<void> => {
    if (!currentDirectoryPath.value) {
      const loaded = await loadFromCache()
      if (!loaded) {
        message.info('请先添加文件夹')
      }
      return
    }

    if (fileData.value.length > 0) {
      return refreshFilesIncremental()
    }

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
   * 增量刷新：把上一轮索引传给主进程，未变目录跳过 readdir
   */
  const refreshFilesIncremental = async (): Promise<void> => {
    if (!currentDirectoryPath.value) {
      const loaded = await loadFromCache()
      if (!loaded) {
        message.info('请先添加文件夹')
      }
      return
    }

    try {
      dirLoading.value = true
      scanProgress.value = { found: 0, active: true }

      const oldFiles = fileData.value
      const newFiles = await readDirectoryRecursive(
        currentDirectoryPath.value,
        oldFiles
      )
      const oldById = new Map(oldFiles.map(f => [f.id, f]))

      let addedCount = 0
      let updatedCount = 0

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
          result[i] = of_
        }
      }

      const removedCount = oldById.size - newFiles.length + addedCount

      fileData.value = result
      scanProgress.value = { found: result.length, active: false }
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
   * 只刷新特定目录的直接子项（并保留更深层已有条目）
   */
  const refreshSpecificDirectory = async (
    targetPath: string,
    options?: { silent?: boolean }
  ): Promise<void> => {
    if (!currentDirectoryPath.value) {
      return
    }

    try {
      if (!options?.silent) dirLoading.value = true

      const normalizedTargetPath = normPath(targetPath)
      // 浅层读取直接子项，避免对父目录（尤其是库根）触发整库递归扫描
      const listing = await window.api.file.readdir(targetPath)
      if (!listing.success || !Array.isArray(listing.data)) {
        throw new Error(listing.error || '读取目录失败')
      }

      const entries = listing.data as Array<{
        name: string
        isDirectory: boolean
        isFile: boolean
      }>
      const videoExts = new Set([
        '.mp4',
        '.avi',
        '.mkv',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.m4v',
      ])
      const newFiles: FileItem[] = []
      for (const entry of entries) {
        const lower = entry.name.toLowerCase()
        if (lower.startsWith('.') || lower.startsWith('__')) continue
        const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : ''
        const isVideo = entry.isFile && videoExts.has(ext)
        const isSidecar =
          entry.isFile &&
          (lower.endsWith('.nfo') || /\.(jpe?g|png|webp)$/i.test(lower))
        if (!entry.isDirectory && !isVideo && !isSidecar) continue

        const childPath = targetPath.includes('\\')
          ? `${targetPath.replace(/[\\/]+$/, '')}\\${entry.name}`
          : `${targetPath.replace(/[\\/]+$/, '')}/${entry.name}`
        let size = 0
        let mtime = Date.now()
        try {
          const st = await window.api.file.stat(childPath)
          if (st.success && st.data) {
            const data = st.data as {
              size?: number
              mtime?: string | Date | number
            }
            size = entry.isFile ? Number(data.size || 0) : 0
            const raw = data.mtime
            mtime =
              typeof raw === 'number'
                ? raw
                : raw
                  ? new Date(raw).getTime()
                  : Date.now()
          }
        } catch {
          // keep defaults
        }
        newFiles.push({
          id: makeId(childPath),
          name: entry.name,
          path: childPath,
          size,
          mtime,
          isDirectory: entry.isDirectory,
          isFile: entry.isFile,
        })
      }

      const oldDirFiles = fileData.value.filter(f => {
        const normalizedPath = normPath(f.path)
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return false
        const relativePart = normalizedPath.slice(
          normalizedTargetPath.length + 1
        )
        return !relativePart.includes('/')
      })

      const oldCount = oldDirFiles.length
      const newCount = newFiles.length

      const otherFiles = fileData.value.filter(f => {
        const normalizedPath = normPath(f.path)
        if (!normalizedPath.startsWith(normalizedTargetPath + '/')) return true
        const relativePart = normalizedPath.slice(
          normalizedTargetPath.length + 1
        )
        return relativePart.includes('/')
      })
      fileData.value = [...otherFiles, ...newFiles]
      saveToCache()

      if (!options?.silent) {
        const diff = newCount - oldCount
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`
        message.success(`刷新完成：${newCount} 个文件 (${diffStr})`)
      }
    } catch (error) {
      if (!options?.silent) {
        message.error(
          `刷新目录失败: ${error instanceof Error ? error.message : '未知错误'}`
        )
      } else {
        console.error('局部刷新失败:', targetPath, error)
      }
    } finally {
      scanProgress.value.active = false
      if (!options?.silent) dirLoading.value = false
    }
  }

  /**
   * 刮削完成后优先局部刷新目标文件夹及其父目录；
   * 路径无效/在库外/等于库根时回退增量/全量刷新。
   * 突发多次调用会合并为一次，并尽量保持局部刷新。
   */
  let refreshPending: Promise<void> | null = null
  let refreshDirty = false
  let pendingFullRefresh = false
  const pendingLocalPaths = new Set<string>()

  const refreshAfterScrape = (folderPath: string): Promise<void> => {
    if (canLocalRefresh(folderPath)) {
      const folder = normPath(folderPath)
      pendingLocalPaths.add(folder)
      const parent = parentDir(folder)
      const rootN = normPath(currentDirectoryPath.value)
      if (parent) {
        const parentKey = parent.toLowerCase()
        const rootKey = rootN.toLowerCase()
        if (parentKey === rootKey || parentKey.startsWith(rootKey + '/')) {
          pendingLocalPaths.add(parent)
        }
      }
    } else {
      pendingFullRefresh = true
    }

    refreshDirty = true
    if (!refreshPending) {
      refreshPending = (async () => {
        do {
          await new Promise(resolve => setTimeout(resolve, 100))
          refreshDirty = false
          const needFull = pendingFullRefresh
          const locals = [...pendingLocalPaths]
          pendingFullRefresh = false
          pendingLocalPaths.clear()

          if (needFull || locals.length === 0) {
            await refreshFiles()
          } else {
            dirLoading.value = true
            try {
              // 短路径（父目录）优先，便于先去掉已移走的视频再写入新文件夹内容
              locals.sort((a, b) => a.length - b.length || a.localeCompare(b))
              const unique: string[] = []
              const seen = new Set<string>()
              for (const p of locals) {
                const key = p.toLowerCase()
                if (seen.has(key)) continue
                seen.add(key)
                unique.push(p)
              }
              for (const p of unique) {
                const diskPath = /^[a-zA-Z]:/.test(p)
                  ? p.replace(/\//g, '\\')
                  : p
                await refreshSpecificDirectory(diskPath, { silent: true })
              }
              message.success(`刮削后已局部刷新 ${unique.length} 个目录`)
            } finally {
              dirLoading.value = false
            }
          }
        } while (refreshDirty)
      })().finally(() => {
        refreshPending = null
      })
    }
    return refreshPending
  }

  const resolveIndexFilePath = async (): Promise<string | null> => {
    if (indexFilePath) return indexFilePath
    try {
      const userData = await window.api.app.getUserDataPath()
      if (!userData) return null
      const sep = userData.includes('\\') ? '\\' : '/'
      indexFilePath = `${userData.replace(/[\\/]+$/, '')}${sep}${INDEX_FILE}`
      return indexFilePath
    } catch (error) {
      console.warn('获取 userData 路径失败，回退 localStorage:', error)
      return null
    }
  }

  const toCompactEntries = (files: FileItem[]): CompactEntry[] =>
    files.map(f => ({
      path: f.path,
      id: f.id || makeId(f.path),
      size: f.size ?? 0,
      mtime: f.mtime ?? 0,
      isFile: f.isFile,
      isDirectory: f.isDirectory,
      name: f.name,
    }))

  /**
   * 保存到缓存：优先 userData 索引文件，localStorage 仅保留路径与轻量备份
   */
  const saveToCache = (): void => {
    if (cacheSaveScheduled) return
    cacheSaveScheduled = true
    const version = cacheSaveVersion
    const persist = async () => {
      cacheSaveScheduled = false
      if (version !== cacheSaveVersion) return
      try {
        const compact = toCompactEntries(fileData.value)
        const payload = {
          currentPath: currentDirectoryPath.value,
          entries: compact,
          savedAt: Date.now(),
        }

        const filePath = await resolveIndexFilePath()
        if (filePath) {
          const writeResult = await window.api.file.write(
            filePath,
            JSON.stringify(payload)
          )
          if (!writeResult.success) {
            console.warn('写入索引文件失败，回退 localStorage:', writeResult.error)
          } else {
            localStorage.setItem(
              'folderContent_currentPath',
              currentDirectoryPath.value
            )
            localStorage.removeItem('folderContent_fileData')
            return
          }
        }

        localStorage.setItem('folderContent_fileData', JSON.stringify(compact))
        localStorage.setItem(
          'folderContent_currentPath',
          currentDirectoryPath.value
        )
      } catch (error) {
        console.error('保存缓存失败:', error)
      }
    }

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        void persist()
      }, { timeout: 1000 })
    } else {
      window.setTimeout(() => {
        void persist()
      }, 0)
    }
  }

  /**
   * 从缓存加载（userData 索引优先，其次 localStorage）
   */
  const loadFromCache = async (): Promise<boolean> => {
    try {
      const filePath = await resolveIndexFilePath()
      if (filePath) {
        const exists = await window.api.file.exists(filePath)
        if (exists.success && exists.exists) {
          const readResult = await window.api.file.read(filePath)
          if (readResult.success && typeof readResult.data === 'string') {
            const parsed = JSON.parse(readResult.data) as {
              currentPath?: string
              entries?: CompactEntry[]
            }
            if (parsed.currentPath && Array.isArray(parsed.entries)) {
              fileData.value = parsed.entries.map(f => ({
                ...f,
                id: f.id || makeId(f.path),
              }))
              currentDirectoryPath.value = parsed.currentPath
              return true
            }
          }
        }
      }

      const cachedData = localStorage.getItem('folderContent_fileData')
      const cachedPath = localStorage.getItem('folderContent_currentPath')

      if (cachedData && cachedPath) {
        const parsed = JSON.parse(cachedData) as FileItem[]
        fileData.value = parsed.map(f => ({ ...f, id: makeId(f.path) }))
        currentDirectoryPath.value = cachedPath
        saveToCache()
        return true
      }
    } catch (error) {
      console.error('加载缓存失败:', error)
    }
    return false
  }

  const clearCache = (): void => {
    cacheSaveVersion++
    cacheSaveScheduled = false
    try {
      localStorage.removeItem('folderContent_fileData')
      localStorage.removeItem('folderContent_currentPath')
      void (async () => {
        const filePath = await resolveIndexFilePath()
        if (filePath) {
          await window.api.file.delete(filePath)
        }
      })()
    } catch (error) {
      console.error('清除缓存失败:', error)
    }
  }

  const clearCacheAndData = (): void => {
    clearCache()
    fileData.value = []
    currentDirectoryPath.value = ''
    message.success('缓存和数据已清除')
  }

  return {
    fileData,
    currentDirectoryPath,
    dirLoading,
    scanProgress,
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