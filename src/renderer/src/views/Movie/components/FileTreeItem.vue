<template>
  <div
    v-context-menu="{
      menuItems: folderMenuItems,
      data: item,
      onItemClick: handleFileAction,
      onBeforeShow: handleRightClick,
    }"
    :class="[
      'flex items-center py-1 px-2 rounded cursor-pointer transition-all duration-300 mb-0.5',
      selectedIndex === index ? 'selected-item' : 'hover:bg-gray-700',
      isSelected && isMultiSelectMode ? 'bg-blue-600 bg-opacity-30' : 'hover:bg-gray-700',
    ]"
    :style="
      selectedIndex === index
        ? {
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
          }
        : {}
    "
    @click="handleItemClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- 多选模式复选框 -->
    <div v-if="isMultiSelectMode" class="mr-3 flex-shrink-0">
      <div
        :class="[
          'w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200',
          isSelected
            ? 'bg-blue-600 border-blue-600'
            : 'border-gray-400 hover:border-blue-400',
        ]"
      >
        <svg
          v-if="isSelected"
          class="w-3 h-3 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="3"
            d="M5 13l4 4L19 7"
          ></path>
        </svg>
      </div>
    </div>

    <div class="flex-1 min-w-0 flex items-center gap-1">
      <div class="text-xs font-medium text-white truncate flex-1">
        {{ item.name }}
      </div>
      <div class="flex gap-0.5 flex-shrink-0">
        <span
          v-if="(item.type === 'folder' && hasNfoFile(item)) || (item.type === 'video' && hasVideoNfoFile(item))"
          class="tag bg-yellow-600 text-yellow-100">N</span>
        <span
          v-if="(item.type === 'folder' && hasPosterFile(item)) || (item.type === 'video' && hasVideoPosterFile(item))"
          class="tag bg-green-600 text-green-100">P</span>
        <span
          v-if="(item.type === 'folder' && hasFanartFile(item)) || (item.type === 'video' && hasVideoFanartFile(item))"
          class="tag bg-blue-600 text-blue-100">A</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { MenuItem } from '@/composables/use-context-menu'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { TMDB_IMG_URL } from '@/api/tmdb'
import type { ProcessedItem } from '@/types'

// 本地Props接口定义
interface Props {
  item: ProcessedItem
  index: number
  selectedIndex: number
  isMultiSelectMode?: boolean
  isSelected?: boolean
}

// 检查视频文件是否有对应的NFO文件
const hasVideoNfoFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'video' || !item.files) return false

  return item.files.some(file => {
    const fileName = file.name.toLowerCase()

    return fileName.endsWith('.nfo')
  })
}

// 检查视频文件是否有对应的海报文件
const hasVideoPosterFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'video' || !item.files) return false

  // 获取视频文件的基础名称（不含扩展名）
  const videoBaseName = item.name
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()

  const posterExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  // 检查同目录下是否有对应的海报文件
  return item.files.some(file => {
    const fileName = file.name.toLowerCase()

    return (
      posterExtensions.some(ext => fileName.endsWith(ext)) &&
      (fileName.includes(videoBaseName) || // 包含视频文件名
        fileName === `${videoBaseName}-poster.jpg` || // {视频文件名}-poster.jpg
        fileName === `${videoBaseName}.jpg` || // {视频文件名}.jpg
        fileName === `${videoBaseName}-folder.jpg` || // {视频文件名}-folder.jpg
        fileName === `${videoBaseName}-movie.jpg` || // {视频文件名}-movie.jpg
        fileName === 'poster.jpg' || // 标准海报文件名
        fileName === 'folder.jpg' || // 标准文件夹图片
        fileName === 'movie.jpg') // 标准电影图片
    )
  })
}

// 检查视频文件是否有对应的艺术图文件
const hasVideoFanartFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'video' || !item.files) return false

  // 获取视频文件的基础名称（不含扩展名）
  const videoBaseName = item.name
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()

  const fanartExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  // 检查同目录下是否有对应的艺术图文件
  return item.files.some(file => {
    const fileName = file.name.toLowerCase()
    return (
      fanartExtensions.some(ext => fileName.endsWith(ext)) &&
      (fileName === `${videoBaseName}-fanart.jpg` || // {视频文件名}-fanart.jpg
        fileName === 'fanart.jpg')
    ) // fanart.jpg
  })
}

const props = defineProps<Props>()

// 海报 data URL
const posterDataUrl = ref<string | null>(null)

// 获取海报路径
const getPosterPath = (item: ProcessedItem): string | null => {
  if (!item.files) return null

  const posterExtensions = ['.jpg', '.jpeg', '.png', '.webp']
  
  // 优先查找 poster.jpg
  let posterFile = item.files.find(file => 
    file.name.toLowerCase() === 'poster.jpg'
  )
  
  // 如果没有，查找包含 poster 的文件
  if (!posterFile) {
    posterFile = item.files.find(file =>
      posterExtensions.some(ext => file.name.toLowerCase().endsWith(ext)) &&
      file.name.toLowerCase().includes('poster')
    )
  }
  
  // 如果还是没有，查找第一个图片文件
  if (!posterFile) {
    posterFile = item.files.find(file =>
      posterExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    )
  }
  
  if (!posterFile) return null
  
  // 将 Windows 路径转换为 file:// 协议格式
  const path = posterFile.path.replace(/\\/g, '/')
  // console.log('海报路径:', path)
  return path
}

// 计算海报路径并读取文件
const loadPoster = async (): Promise<void> => {
  try {
    if (!props.item?.hasPoster || !props.item?.files) {
      posterDataUrl.value = null
      return
    }
    
    const path = getPosterPath(props.item)
    if (!path) {
      posterDataUrl.value = null
      return
    }
    
    // console.log('读取海报文件:', path)
    const result = await window.api.file.read(path)
    
    if (result.success && result.data) {
      // 将文件内容转换为 base64 data URL
      const uint8Array = new Uint8Array(result.data as ArrayBuffer)
      let binary = ''
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i])
      }
      const base64 = btoa(binary)
      posterDataUrl.value = `data:image/jpeg;base64,${base64}`
    } else {
      console.error('读取海报失败:', result.error)
      posterDataUrl.value = null
    }
  } catch (error) {
    console.error('加载海报时出错:', error)
    posterDataUrl.value = null
  }
}

// 监听 item 变化，重新加载海报
watch(() => props.item, () => {
  loadPoster()
}, { immediate: true })
const emit = defineEmits<{
  select: [item: ProcessedItem, index: number]
  showSearchModal: [item: ProcessedItem]
  autoScrape: [item: ProcessedItem]
  directScrape: [item: ProcessedItem]
  toggleSelection: [item: ProcessedItem, index: number]
  manualScrape: [item: ProcessedItem]
  preload: [item: ProcessedItem]
  localScrape: [item: ProcessedItem]
  downloadVideo: [item: ProcessedItem]
  fetchMeta: [item: ProcessedItem]
}>()

/**
 * 处理项目点击事件
 * 在多选模式下切换选择状态，在单选模式下执行正常选择
 */
const handleItemClick = (): void => {
  if (props.isMultiSelectMode) {
    emit('toggleSelection', props.item, props.index)
  } else {
    emit('select', props.item, props.index)
  }
}

/**
 * 处理右键点击事件
 * 右键点击时自动选中项目
 */
const handleRightClick = (): void => {
  // 不阻止默认行为，让 context-menu 指令正常工作
  // 右键点击时也触发选中逻辑
  if (props.isMultiSelectMode) {
    emit('toggleSelection', props.item, props.index)
  } else {
    emit('select', props.item, props.index)
  }
}

/**
 * 鼠标悬停预加载
 */
const handleMouseEnter = (): void => {
  // 仅对文件夹预加载
  if (props.item.type === 'folder') {
    emit('preload', props.item)
  }
}

// 检查是否有NFO文件
const hasNfoFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'folder' || !item.files) return false

  // 获取文件夹中的视频文件
  const videoFiles = item.files.filter(file => {
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

    return videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
  })

  // 如果有视频文件，检查是否有对应的NFO文件
  if (videoFiles.length > 0) {
    return videoFiles.some(videoFile => {
      const videoBaseName = videoFile.name.replace(/\.[^/.]+$/, '') // 移除扩展名

      return item.files!.some(file => {
        const fileName = file.name.toLowerCase()

        const videoBaseNameLower = videoBaseName.toLowerCase()

        return (
          fileName.endsWith('.nfo') &&
          (fileName === `${videoBaseNameLower}.nfo` ||
            fileName.includes(videoBaseNameLower))
        )
      })
    })
  }

  // 检查传统的nfo文件
  return item.files.some(file => file.name.toLowerCase().endsWith('.nfo'))
}

// 检查是否有海报文件
const hasPosterFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'folder' || !item.files) return false

  const posterExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  const folderName = item.name.toLowerCase()

  // 获取文件夹中的视频文件
  const videoFiles = item.files.filter(file => {
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

    return videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
  })

  // 如果有视频文件，检查是否有对应的海报文件
  if (videoFiles.length > 0) {
    const hasVideoRelatedImages = videoFiles.some(videoFile => {
      const videoBaseName = videoFile.name.replace(/\.[^/.]+$/, '') // 移除扩展名

      return item.files!.some(file => {
        const fileName = file.name.toLowerCase()

        const videoBaseNameLower = videoBaseName.toLowerCase()

        return (
          posterExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName.includes(videoBaseNameLower) || // 包含视频文件名
            fileName === `${videoBaseNameLower}-poster.jpg` || // {视频文件名}-poster.jpg
            fileName === `${videoBaseNameLower}.jpg`)
        ) // {视频文件名}.jpg
      })
    })

    if (hasVideoRelatedImages) return true
  }

  // 检查传统的海报文件
  return item.files.some(file => {
    const fileName = file.name.toLowerCase()

    return (
      posterExtensions.some(ext => fileName.endsWith(ext)) &&
      (fileName.includes('poster') ||
        fileName.includes('cover') ||
        fileName.includes('folder') ||
        fileName.includes('thumb') ||
        fileName === 'poster.jpg' ||
        fileName === 'folder.jpg' ||
        fileName === 'movie.jpg' ||
        fileName === 'cover.jpg' ||
        fileName.includes(folderName.split('(')[0].trim())) // 支持包含电影名字的文件
    )
  })
}

// 检查是否有艺术图文件
const hasFanartFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'folder' || !item.files) return false

  const fanartExtensions = ['.jpg', '.jpeg', '.png', '.webp']

  const folderName = item.name.toLowerCase()

  // 获取文件夹中的视频文件
  const videoFiles = item.files.filter(file => {
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

    return videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
  })

  // 如果有视频文件，检查是否有对应的艺术图文件
  if (videoFiles.length > 0) {
    const hasVideoRelatedFanart = videoFiles.some(videoFile => {
      const videoBaseName = videoFile.name.replace(/\.[^/.]+$/, '') // 移除扩展名

      return item.files!.some(file => {
        const fileName = file.name.toLowerCase()

        const videoBaseNameLower = videoBaseName.toLowerCase()

        return (
          fanartExtensions.some(ext => fileName.endsWith(ext)) &&
          (fileName === `${videoBaseNameLower}-fanart.jpg` || // {视频文件名}-fanart.jpg
            fileName === 'fanart.jpg')
        ) // fanart.jpg
      })
    })

    if (hasVideoRelatedFanart) return true
  }

  // 检查传统的艺术图文件
  return item.files.some(file => {
    const fileName = file.name.toLowerCase()

    return (
      fanartExtensions.some(ext => fileName.endsWith(ext)) &&
      (fileName.includes('fanart') ||
        fileName.includes('backdrop') ||
        fileName === 'fanart.jpg' ||
        fileName.includes(folderName.split('(')[0].trim())) // 支持包含电影名字的文件
    )
  })
}

// 处理图片加载错误
const handleImageError = (event: Event): void => {
  console.error('海报加载失败:', event)
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
}

// 静态图片菜单
const folderMenuItems: MenuItem[] = [
  { id: 'view', label: '刮削', icon: 'fas fa-eye' },
  { id: 'local-scrape', label: '本地刮削' },
  { id: 'fetch-meta', label: '预览元数据' },
  { id: 'download', label: '下载视频' },
]

const handleFileAction = (action: MenuItem, item: ProcessedItem): void => {
  if (action.id === 'view') {
    emit('autoScrape', item)
  } else if (action.id === 'local-scrape') {
    emit('localScrape', item)
  } else if (action.id === 'fetch-meta') {
    emit('fetchMeta', item)
  } else if (action.id === 'download') {
    emit('downloadVideo', item)
  }
}

/**
 * 获取父文件夹路径
 * @param item 文件或文件夹项
 * @returns 父文件夹路径
 */
const getParentFolderPath = (item: ProcessedItem): string => {
  if (item.type === 'folder') {
    return item.path
  } else {
    // 如果是视频文件，返回其父目录路径（支持 Windows 和 Unix 路径）
    const lastSlashIndex = Math.max(
      item.path.lastIndexOf('/'),
      item.path.lastIndexOf('\\')
    )
    if (lastSlashIndex === -1) {
      return item.path
    }
    return item.path.substring(0, lastSlashIndex)
  }
}

/**
 * 创建NFO文件内容
 * @param movieData 电影数据
 * @returns NFO XML内容
 */
const createNfoContent = (movieData: Movie): string => {
  const releaseYear = movieData.release_date
    ? new Date(movieData.release_date).getFullYear()
    : ''

  return
  ;`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <movie>
  <title>${escapeXml(movieData.title || '')}</title>
  <originaltitle>${escapeXml(movieData.original_title || '')}</originaltitle>
  <year>${releaseYear}</year>
  <plot>${escapeXml(movieData.overview || '')}</plot>
  <runtime></runtime>
  <mpaa></mpaa>
  <id>${movieData.id}</id>
  <tmdbid>${movieData.id}</tmdbid>
  <premiered>${movieData.release_date || ''}</premiered>
  <releasedate>${movieData.release_date || ''}</releasedate>
  <rating>${movieData.vote_average || 0}</rating>
  <votes>${movieData.vote_count || 0}</votes>
  <popularity>${movieData.popularity || 0}</popularity>
  <adult>${movieData.adult || false}</adult>
  <language>${movieData.original_language || ''}</language>
  <poster>${movieData.poster_path ? (movieData.poster_path.startsWith('http') ? movieData.poster_path : TMDB_IMG_URL + movieData.poster_path) : ''}</poster>
  <fanart>${movieData.backdrop_path ? (movieData.backdrop_path.startsWith('http') ? movieData.backdrop_path : TMDB_IMG_URL + movieData.backdrop_path) : ''}</fanart>
</movie>`
}

/**
 * 转义XML特殊字符
 * @param text 要转义的文本
 * @returns 转义后的文本
 */
const escapeXml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
</script>

<style scoped>
.selected-item {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
  transition: all 0.3s ease;
}

.tag {
  font-size: 9px;
  padding: 1px 3px;
  border-radius: 2px;
  line-height: 1;
  flex-shrink: 0;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
