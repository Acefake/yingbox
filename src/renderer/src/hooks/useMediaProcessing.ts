import { ref, computed, watch } from 'vue'
import type { ProcessedItem, MovieInfoType } from '../types'
import { useErrorHandler } from './useErrorHandler'

/**
 * 媒体处理hook
 */
export const useMediaProcessing = (selectedItem: any) => {
  const { safeExecute } = useErrorHandler()
  
  const posterImageDataUrl = ref('')
  const fanartImageDataUrl = ref('')
  const nfoContent = ref('')
  const movieInfo = ref<MovieInfoType | null>(null)

  // 图片扩展名
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  /**
   * 计算海报图片路径
   */
  const posterImagePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const folderName = selectedItem.value.name.toLowerCase()

      const posterFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          !fileName.includes('fanart') &&
          !fileName.includes('backdrop') &&
          (fileName.includes('poster') ||
            fileName.includes('cover') ||
            fileName.includes('folder') ||
            fileName.includes('thumb') ||
            fileName === 'poster.jpg' ||
            fileName === 'folder.jpg' ||
            fileName === 'movie.jpg' ||
            fileName === 'cover.jpg' ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              !fileName.includes('fanart') &&
              !fileName.includes('backdrop')))
        )
      })

      return posterFile ? posterFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的海报检测
      const videoBaseName = selectedItem.value.name
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()

      const posterFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName === `${videoBaseName}-poster.jpg` ||
            fileName === `${videoBaseName}-folder.jpg` ||
            fileName === `${videoBaseName}-movie.jpg` ||
            fileName === 'poster.jpg' ||
            fileName === 'folder.jpg' ||
            fileName === 'movie.jpg')
        )
      })

      return posterFile ? posterFile.path : null
    }

    return null
  })

  /**
   * 计算艺术图片路径
   */
  const fanartImagePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const folderName = selectedItem.value.name.toLowerCase()

      const fanartFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName.includes('fanart') ||
            fileName.includes('backdrop') ||
            fileName === 'fanart.jpg' ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              fileName.includes('fanart')) ||
            (fileName.includes(folderName.split('(')[0].trim()) &&
              fileName.includes('backdrop')))
        )
      })

      return fanartFile ? fanartFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的艺术图检测
      const videoBaseName = selectedItem.value.name
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()

      const fanartFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()

        return (
          imageExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName === `${videoBaseName}-fanart.jpg` ||
            fileName === 'fanart.jpg')
        )
      })

      return fanartFile ? fanartFile.path : null
    }

    return null
  })

  /**
   * 计算NFO文件路径
   */
  const nfoFilePath = computed(() => {
    if (!selectedItem.value || !selectedItem.value.files) {
      return null
    }

    if (selectedItem.value.type === 'folder') {
      const nfoFile = selectedItem.value.files.find((file: any) =>
        file.name.toLowerCase().endsWith('.nfo')
      )

      return nfoFile ? nfoFile.path : null
    } else if (selectedItem.value.type === 'video') {
      // 视频文件的NFO检测 - 只要同目录下有NFO文件就认为有对应的NFO
      const nfoFile = selectedItem.value.files.find((file: any) => {
        const fileName = file.name.toLowerCase()
        return fileName.endsWith('.nfo')
      })

      return nfoFile ? nfoFile.path : null
    }

    return null
  })

  /**
   * 加载海报图片
   */
  const loadPosterImage = async (): Promise<void> => {
    posterImageDataUrl.value = ''
    if (!posterImagePath.value) return

    await safeExecute(
      async () => {
        const result = await window.api.file.readImage(posterImagePath.value!)
        
        if (!result.success || !result.data) {
          throw new Error(result.error || '读取海报图片失败')
        }

        posterImageDataUrl.value = result.data as string
        return result.data
      },
      '加载海报图片失败'
    )
  }

  /**
   * 加载艺术图片
   */
  const loadFanartImage = async (): Promise<void> => {
    fanartImageDataUrl.value = ''
    if (!fanartImagePath.value) return

    await safeExecute(
      async () => {
        const result = await window.api.file.readImage(fanartImagePath.value!)
        
        if (!result.success || !result.data) {
          throw new Error(result.error || '读取艺术图片失败')
        }

        fanartImageDataUrl.value = result.data as string
        return result.data
      },
      '加载艺术图片失败'
    )
  }

  /**
   * 加载NFO文件内容
   */
  const loadNfoContent = async (): Promise<void> => {
    nfoContent.value = ''
    movieInfo.value = null
    if (!nfoFilePath.value) return

    await safeExecute(
      async () => {
        const result = await window.api.file.read(nfoFilePath.value!)
        
        if (!result.success || !result.data) {
          throw new Error(result.error || '读取NFO文件失败')
        }

        nfoContent.value = result.data as string
        parseNfoContent(result.data as string)
        return result.data
      },
      '加载NFO文件失败'
    )
  }

  /**
   * 解析NFO内容
   */
  const parseNfoContent = (content: string): void => {
    movieInfo.value = null
    if (!content) return

    try {
      const info: MovieInfoType = {}

      // 提取标题
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i)
      if (titleMatch) info.title = titleMatch[1].trim()

      // 提取原始标题
      const originalTitleMatch = content.match(/<originaltitle>([^<]+)<\/originaltitle>/i)
      if (originalTitleMatch) info.originaltitle = originalTitleMatch[1].trim()

      // 提取年份
      const yearMatch = content.match(/<year>(\d{4})<\/year>/i)
      if (yearMatch) info.year = yearMatch[1]

      // 提取剧情简介
      const plotMatch = content.match(/<plot>([^<]+)<\/plot>/i)
      if (plotMatch) info.plot = plotMatch[1].trim()

      // 提取类型
      const genreMatches = content.match(/<genre>([^<]+)<\/genre>/gi)
      if (genreMatches) {
        info.genre = genreMatches.map(match =>
          match.replace(/<\/?genre>/gi, '').trim()
        )
      }

      // 提取导演
      const directorMatch = content.match(/<director>([^<]+)<\/director>/i)
      if (directorMatch) info.director = directorMatch[1].trim()

      // 提取演员
      const actorMatches = content.match(/<actor>\s*<name>([^<]+)<\/name>/gi)
      if (actorMatches) {
        info.actor = actorMatches
          .map(match => {
            const nameMatch = match.match(/<name>([^<]+)<\/name>/i)
            return nameMatch ? nameMatch[1].trim() : ''
          })
          .filter(name => name)
      }

      // 提取评分
      const ratingMatch = content.match(/<rating>([^<]+)<\/rating>/i)
      if (ratingMatch) info.rating = ratingMatch[1].trim()

      // 提取时长
      const runtimeMatch = content.match(/<runtime>([^<]+)<\/runtime>/i)
      if (runtimeMatch) info.runtime = runtimeMatch[1].trim()

      // 提取国家
      const countryMatch = content.match(/<country>([^<]+)<\/country>/i)
      if (countryMatch) info.country = countryMatch[1].trim()

      // 提取制片公司
      const studioMatch = content.match(/<studio>([^<]+)<\/studio>/i)
      if (studioMatch) info.studio = studioMatch[1].trim()

      // 提取首映日期
      const premieredMatch = content.match(/<premiered>([^<]+)<\/premiered>/i)
      if (premieredMatch) info.premiered = premieredMatch[1].trim()

      movieInfo.value = info
    } catch (error) {
      console.error('解析NFO内容失败:', error)
    }
  }

  // 监听器
  watch(posterImagePath, loadPosterImage, { immediate: true })
  watch(fanartImagePath, loadFanartImage, { immediate: true })
  watch(nfoFilePath, loadNfoContent, { immediate: true })

  return {
    // 状态
    posterImageDataUrl,
    fanartImageDataUrl,
    nfoContent,
    movieInfo,
    
    // 计算属性
    posterImagePath,
    fanartImagePath,
    nfoFilePath,
    
    // 方法
    loadPosterImage,
    loadFanartImage,
    loadNfoContent,
  }
}

