import { ref, computed } from 'vue'
import type { FileItem, ProcessedItem } from '@/types'

/**
 * 文件管理Hook
 * 
 * 提供文件读取、目录操作、缓存管理等功能
 * 包括文件系统操作、数据处理和状态管理
 */
export const useFileManager = () => {
  // 响应式状态
  const fileData = ref<FileItem[]>([])
  const processedItems = ref<ProcessedItem[]>([])
  const currentDirectoryPath = ref<string>('')
  const selectedItem = ref<ProcessedItem | null>(null)
  const selectedIndex = ref<number>(-1)
  const dirLoading = ref<boolean>(false)
  const error = ref<string | null>(null)

  /**
   * 读取目录内容
   * @param directoryPath 目录路径
   */
  const readDirectory = async (directoryPath: string) => {
    if (!directoryPath) {
      console.warn('目录路径为空')
      return
    }

    dirLoading.value = true
    error.value = null

    try {
      // 调用主进程API读取目录
      const result = await window.electronAPI.readDir(directoryPath)
      
      if (result.success) {
        fileData.value = result.data || []
        currentDirectoryPath.value = directoryPath
        
        // 处理文件数据
        await processFileData()
      } else {
        error.value = result.error || '读取目录失败'
        fileData.value = []
        processedItems.value = []
      }
    } catch (err) {
      console.error('读取目录失败:', err)
      error.value = '读取目录时发生错误'
      fileData.value = []
      processedItems.value = []
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 处理文件数据，转换为ProcessedItem格式
   */
  const processFileData = async () => {
    if (!fileData.value.length) {
      processedItems.value = []
      return
    }

    try {
      const processed: ProcessedItem[] = []

      for (const file of fileData.value) {
        // 检查是否为视频文件或包含视频文件的文件夹
        const isVideoFile = isVideo(file.name)
        const isDirectory = file.isDirectory
        
        if (isVideoFile || isDirectory) {
          const processedItem: ProcessedItem = {
            name: file.name,
            path: file.path,
            isDirectory,
            isVideo: isVideoFile,
            size: file.size,
            modifiedTime: file.modifiedTime,
            hasNfo: false,
            hasPoster: false,
            hasFanart: false,
            children: []
          }

          // 如果是目录，检查其中的文件
          if (isDirectory) {
            try {
              const dirResult = await window.electronAPI.readDir(file.path)
              if (dirResult.success && dirResult.data) {
                processedItem.children = dirResult.data
                
                // 检查是否有NFO、海报等文件
                processedItem.hasNfo = dirResult.data.some(child => 
                  child.name.toLowerCase().endsWith('.nfo')
                )
                processedItem.hasPoster = dirResult.data.some(child => 
                  isPosterFile(child.name)
                )
                processedItem.hasFanart = dirResult.data.some(child => 
                  isFanartFile(child.name)
                )
              }
            } catch (err) {
              console.warn(`读取子目录失败: ${file.path}`, err)
            }
          }

          processed.push(processedItem)
        }
      }

      processedItems.value = processed
    } catch (err) {
      console.error('处理文件数据失败:', err)
      error.value = '处理文件数据时发生错误'
    }
  }

  /**
   * 刷新当前目录
   */
  const refreshDirectory = async () => {
    if (currentDirectoryPath.value) {
      await readDirectory(currentDirectoryPath.value)
    }
  }

  /**
   * 选择文件项
   * @param item 文件项
   * @param index 索引
   */
  const selectItem = (item: ProcessedItem, index: number) => {
    selectedItem.value = item
    selectedIndex.value = index
  }

  /**
   * 清除选择
   */
  const clearSelection = () => {
    selectedItem.value = null
    selectedIndex.value = -1
  }

  /**
   * 检查是否为视频文件
   * @param filename 文件名
   */
  const isVideo = (filename: string): boolean => {
    const videoExtensions = [
      '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
      '.m4v', '.3gp', '.3g2', '.f4v', '.asf', '.rm', '.rmvb',
      '.vob', '.ogv', '.drc', '.gif', '.gifv', '.mng', '.qt',
      '.yuv', '.rm', '.asf', '.amv', '.mp2', '.mpe', '.mpv',
      '.m2v', '.svi', '.3gpp', '.3gpp2', '.mxf', '.roq', '.nsv'
    ]
    
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
    return videoExtensions.includes(ext)
  }

  /**
   * 检查是否为海报文件
   * @param filename 文件名
   */
  const isPosterFile = (filename: string): boolean => {
    const lowerName = filename.toLowerCase()
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']
    const posterNames = ['poster', 'cover', 'folder']
    
    return imageExtensions.some(ext => lowerName.endsWith(ext)) &&
           posterNames.some(name => lowerName.includes(name))
  }

  /**
   * 检查是否为艺术图文件
   * @param filename 文件名
   */
  const isFanartFile = (filename: string): boolean => {
    const lowerName = filename.toLowerCase()
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']
    const fanartNames = ['fanart', 'backdrop', 'background']
    
    return imageExtensions.some(ext => lowerName.endsWith(ext)) &&
           fanartNames.some(name => lowerName.includes(name))
  }

  /**
   * 获取文件的完整路径
   * @param item 文件项
   * @param filename 文件名
   */
  const getFilePath = (item: ProcessedItem, filename: string): string => {
    if (item.isDirectory) {
      return `${item.path}/${filename}`
    } else {
      const dir = item.path.substring(0, item.path.lastIndexOf('/'))
      return `${dir}/${filename}`
    }
  }

  /**
   * 检查文件是否存在
   * @param filePath 文件路径
   */
  const fileExists = async (filePath: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.fileExists(filePath)
      return result.exists
    } catch (err) {
      console.error('检查文件存在性失败:', err)
      return false
    }
  }

  /**
   * 读取文件内容
   * @param filePath 文件路径
   */
  const readFile = async (filePath: string): Promise<string | null> => {
    try {
      const result = await window.electronAPI.readFile(filePath)
      return result.success ? result.data : null
    } catch (err) {
      console.error('读取文件失败:', err)
      return null
    }
  }

  /**
   * 写入文件
   * @param filePath 文件路径
   * @param content 文件内容
   */
  const writeFile = async (filePath: string, content: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.writeFile(filePath, content)
      return result.success
    } catch (err) {
      console.error('写入文件失败:', err)
      return false
    }
  }

  /**
   * 清除缓存
   */
  const clearCache = () => {
    fileData.value = []
    processedItems.value = []
    currentDirectoryPath.value = ''
    clearSelection()
    error.value = null
  }

  // 计算属性
  const hasFiles = computed(() => processedItems.value.length > 0)
  const hasSelection = computed(() => !!selectedItem.value)
  const isLoading = computed(() => dirLoading.value)
  const hasError = computed(() => !!error.value)

  return {
    // 状态
    fileData,
    processedItems,
    currentDirectoryPath,
    selectedItem,
    selectedIndex,
    dirLoading,
    error,
    
    // 计算属性
    hasFiles,
    hasSelection,
    isLoading,
    hasError,
    
    // 方法
    readDirectory,
    refreshDirectory,
    selectItem,
    clearSelection,
    isVideo,
    isPosterFile,
    isFanartFile,
    getFilePath,
    fileExists,
    readFile,
    writeFile,
    clearCache
  }
}