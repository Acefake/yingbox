/**
 * 文件管理 Store
 * 管理文件列表、目录路径等状态
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { message } from 'ant-design-vue'
import type { FileItem, ProcessedItem } from '@/types'

// 视频文件扩展名
const VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.mkv',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
]

export const useFileStore = defineStore('file', () => {
  // 状态
  const fileData = ref<FileItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const dirLoading = ref(false)

  // 计算属性：处理后的文件列表
  const processedItems = computed((): ProcessedItem[] => {
    return processFiles(fileData.value)
  })

  /**
   * 判断是否为视频文件
   */
  const isVideoFile = (fileName: string): boolean => {
    return VIDEO_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext))
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

      // 检测是否已有 NFO、海报和背景图
      const hasNfo = folderFiles.some(file => file.name.toLowerCase().endsWith('.nfo'))
      const hasPoster = folderFiles.some(file =>
        file.name.toLowerCase().includes('poster') || file.name.toLowerCase() === 'poster.jpg'
      )
      const hasFanart = folderFiles.some(file =>
        file.name.toLowerCase().includes('fanart') ||
        file.name.toLowerCase().includes('backdrop') ||
        file.name.toLowerCase() === 'fanart.jpg'
      )

      console.log(`文件夹 ${folder.name} 资源检测:`, { hasNfo, hasPoster, hasFanart })

      if (folderFiles.length > 0 && hasVideoFiles) {
        result.push({
          name: folder.name,
          path: folder.path,
          type: 'folder',
          fileCount: folderFiles.length,
          files: folderFiles,
          hasNfo,
          hasPoster,
          hasFanart,
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
      console.log('=== 处理独立视频文件 ===')
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
          // console.log(`文件 ${file.name}:`, {
          //   inDirectory,
          //   noSubdir,
          //   path: file.path,
          //   videoDir: videoDir + separator
          // })
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
  const readDirectory = async (): Promise<FileItem[] | null> => {
    console.log('=== 开始读取目录 ===')
    try {
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
      saveToCache()

      message.success(`成功扫描 ${scannedFiles.length} 个文件`)
      console.log('=== 目录读取完成 ===')
      return scannedFiles
    } catch (error) {
      message.error('读取目录失败')
      console.error('读取目录失败:', error)
      return null
    }
  }

  /**
   * 刷新文件列表
   */
  const refreshFiles = async (): Promise<FileItem[] | null> => {
    if (!currentDirectoryPath.value) {
      const loaded = loadFromCache()
      if (loaded) {
        message.success('已从缓存加载数据')
        return fileData.value
      } else {
        message.info('请先添加文件夹')
        return null
      }
    }

    try {
      dirLoading.value = true
      message.info('正在刷新文件列表...')

      const files = await window.api.file.readdirRecursive(
        currentDirectoryPath.value
      )

      if (!files.success || !files.data) {
        throw new Error(files.error || '刷新失败')
      }

      fileData.value = files.data as FileItem[]
      saveToCache()

      message.success(
        `刷新完成：找到 ${(files.data as FileItem[]).length} 个文件`
      )
      return files.data as FileItem[]
    } catch (error) {
      message.error('刷新目录失败')
      console.error('刷新目录失败:', error)
      return null
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
   * 清除缓存和数据
   */
  const clearCacheAndData = (): void => {
    try {
      localStorage.removeItem('folderContent_fileData')
      localStorage.removeItem('folderContent_currentPath')
      fileData.value = []
      currentDirectoryPath.value = ''
      message.success('缓存和数据已清除')
    } catch (error) {
      console.error('清除缓存失败:', error)
    }
  }

  return {
    // 状态
    fileData,
    currentDirectoryPath,
    dirLoading,
    processedItems,

    // 方法
    isVideoFile,
    isHiddenFile,
    processFiles,
    readDirectory,
    refreshFiles,
    saveToCache,
    loadFromCache,
    clearCacheAndData,
  }
})
