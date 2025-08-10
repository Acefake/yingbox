import { ref, computed } from 'vue'
import type { ProcessedItem } from '@/types'

// Electron API 类型声明
declare global {
  interface Window {
    electronAPI: {
      fileExists: (filePath: string) => Promise<{ exists: boolean }>
      readImageAsDataUrl: (imagePath: string) => Promise<{ success: boolean; dataUrl?: string }>
    }
  }
}

/**
 * 图片路径管理Hook
 * 
 * 提供海报、艺术图路径计算和加载功能
 * 包括路径解析、图片缓存和数据URL生成
 */
export const useImagePaths = () => {
  // 响应式状态
  const posterImageDataUrl = ref<string>('')
  const fanartImageDataUrl = ref<string>('')
  const imageCache = ref<Map<string, string>>(new Map())
  const loadingImages = ref<Set<string>>(new Set())

  /**
   * 获取海报图片路径
   * @param item 文件项
   */
  const getPosterImagePath = (item: ProcessedItem | null): string => {
    if (!item) return ''

    if (item.isDirectory) {
      // 文件夹：查找poster相关文件
      const posterFile = item.children?.find(file => 
        isPosterFile(file.name)
      )
      return posterFile ? posterFile.path : ''
    } else {
      // 视频文件：查找同名poster文件
      const baseName = getBaseName(item.name)
      const directory = getDirectoryPath(item.path)
      
      // 常见的海报文件名模式
      const posterPatterns = [
        `${baseName}-poster.jpg`,
        `${baseName}-poster.png`,
        `${baseName}.jpg`,
        `${baseName}.png`,
        'poster.jpg',
        'poster.png',
        'folder.jpg',
        'folder.png',
        'cover.jpg',
        'cover.png'
      ]
      
      // 返回第一个可能存在的路径（实际存在性需要后续验证）
      return `${directory}/${posterPatterns[0]}`
    }
  }

  /**
   * 获取艺术图路径
   * @param item 文件项
   */
  const getFanartImagePath = (item: ProcessedItem | null): string => {
    if (!item) return ''

    if (item.isDirectory) {
      // 文件夹：查找fanart相关文件
      const fanartFile = item.children?.find(file => 
        isFanartFile(file.name)
      )
      return fanartFile ? fanartFile.path : ''
    } else {
      // 视频文件：查找同名fanart文件
      const baseName = getBaseName(item.name)
      const directory = getDirectoryPath(item.path)
      
      // 常见的艺术图文件名模式
      const fanartPatterns = [
        `${baseName}-fanart.jpg`,
        `${baseName}-fanart.png`,
        `${baseName}-backdrop.jpg`,
        `${baseName}-backdrop.png`,
        'fanart.jpg',
        'fanart.png',
        'backdrop.jpg',
        'backdrop.png',
        'background.jpg',
        'background.png'
      ]
      
      return `${directory}/${fanartPatterns[0]}`
    }
  }

  /**
   * 加载图片为Data URL
   * @param imagePath 图片路径
   */
  const loadImageAsDataUrl = async (imagePath: string): Promise<string> => {
    if (!imagePath) return ''

    // 检查缓存
    if (imageCache.value.has(imagePath)) {
      return imageCache.value.get(imagePath)!
    }

    // 检查是否正在加载
    if (loadingImages.value.has(imagePath)) {
      // 等待加载完成
      return new Promise((resolve) => {
        const checkCache = () => {
          if (imageCache.value.has(imagePath)) {
            resolve(imageCache.value.get(imagePath)!)
          } else if (!loadingImages.value.has(imagePath)) {
            resolve('')
          } else {
            setTimeout(checkCache, 100)
          }
        }
        checkCache()
      })
    }

    loadingImages.value.add(imagePath)

    try {
      // 检查文件是否存在
      const existsResult = await window.electronAPI.fileExists(imagePath)
      if (!existsResult.exists) {
        imageCache.value.set(imagePath, '')
        return ''
      }

      // 读取图片文件
      const result = await window.electronAPI.readImageAsDataUrl(imagePath)
      
      if (result.success && result.dataUrl) {
        imageCache.value.set(imagePath, result.dataUrl)
        return result.dataUrl
      } else {
        imageCache.value.set(imagePath, '')
        return ''
      }
    } catch (error) {
      console.error('加载图片失败:', error)
      imageCache.value.set(imagePath, '')
      return ''
    } finally {
      loadingImages.value.delete(imagePath)
    }
  }

  /**
   * 加载海报图片
   * @param item 文件项
   */
  const loadPosterImage = async (item: ProcessedItem | null) => {
    const posterPath = getPosterImagePath(item)
    posterImageDataUrl.value = await loadImageAsDataUrl(posterPath)
  }

  /**
   * 加载艺术图
   * @param item 文件项
   */
  const loadFanartImage = async (item: ProcessedItem | null) => {
    const fanartPath = getFanartImagePath(item)
    fanartImageDataUrl.value = await loadImageAsDataUrl(fanartPath)
  }

  /**
   * 加载所有图片
   * @param item 文件项
   */
  const loadAllImages = async (item: ProcessedItem | null) => {
    await Promise.all([
      loadPosterImage(item),
      loadFanartImage(item)
    ])
  }

  /**
   * 清除图片数据
   */
  const clearImages = () => {
    posterImageDataUrl.value = ''
    fanartImageDataUrl.value = ''
  }

  /**
   * 清除图片缓存
   * @param imagePath 可选的特定路径，不提供则清除所有缓存
   */
  const clearImageCache = (imagePath?: string) => {
    if (imagePath) {
      imageCache.value.delete(imagePath)
    } else {
      imageCache.value.clear()
    }
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
   * 获取文件基础名（不含扩展名）
   * @param filename 文件名
   */
  const getBaseName = (filename: string): string => {
    const lastDotIndex = filename.lastIndexOf('.')
    return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename
  }

  /**
   * 获取目录路径
   * @param filePath 文件路径
   */
  const getDirectoryPath = (filePath: string): string => {
    const lastSlashIndex = filePath.lastIndexOf('/')
    return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : ''
  }

  /**
   * 预加载图片
   * @param imagePaths 图片路径数组
   */
  const preloadImages = async (imagePaths: string[]) => {
    const loadPromises = imagePaths.map(path => loadImageAsDataUrl(path))
    await Promise.allSettled(loadPromises)
  }

  /**
   * 获取缓存统计信息
   */
  const getCacheStats = () => {
    return {
      cacheSize: imageCache.value.size,
      loadingCount: loadingImages.value.size,
      cachedPaths: Array.from(imageCache.value.keys())
    }
  }

  // 计算属性
  const hasPosterImage = computed(() => !!posterImageDataUrl.value)
  const hasFanartImage = computed(() => !!fanartImageDataUrl.value)
  const isLoadingAny = computed(() => loadingImages.value.size > 0)
  const cacheSize = computed(() => imageCache.value.size)

  return {
    // 状态
    posterImageDataUrl,
    fanartImageDataUrl,
    imageCache,
    loadingImages,
    
    // 计算属性
    hasPosterImage,
    hasFanartImage,
    isLoadingAny,
    cacheSize,
    
    // 方法
    getPosterImagePath,
    getFanartImagePath,
    loadImageAsDataUrl,
    loadPosterImage,
    loadFanartImage,
    loadAllImages,
    clearImages,
    clearImageCache,
    isPosterFile,
    isFanartFile,
    getBaseName,
    getDirectoryPath,
    preloadImages,
    getCacheStats
  }
}