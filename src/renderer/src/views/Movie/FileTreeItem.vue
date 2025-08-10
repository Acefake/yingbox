<template>
  <div
    v-context-menu="{
      menuItems: folderMenuItems,
      data: item,
      onItemClick: handleFileAction,
    }"
    :class="[
      'flex items-center p-2 rounded cursor-pointer transition-all duration-300 mb-1',
      selectedIndex === index ? 'selected-item' : 'hover:bg-gray-700',
      isSelected && isMultiSelectMode ? 'bg-blue-600 bg-opacity-30' : '',
    ]"
    :style="
      selectedIndex === index
        ? {
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
          }
        : {}
    "
    @click="handleItemClick"
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

    <!-- 文件夹图标 -->
    <svg
      v-if="item.type === 'folder'"
      class="w-5 h-5 text-blue-400 mr-3 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
      ></path>
    </svg>

    <!-- 视频文件图标 -->
    <svg
      v-else-if="item.type === 'video'"
      class="w-5 h-5 text-red-400 mr-3 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fill-rule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
        clip-rule="evenodd"
      ></path>
    </svg>

    <div class="flex-1 min-w-0">
      <div class="text-xs font-medium text-white truncate flex items-center">
        {{ item.name }}
      </div>
      <div class="flex gap-1 mt-1">
        <span
          v-if="
            (item.type === 'folder' && hasNfoFile(item)) ||
            (item.type === 'video' && hasVideoNfoFile(item))
          "
          :style="{ fontSize: '10px' }"
          class="px-1 py-0.5 bg-yellow-600 text-yellow-100 rounded"
          >NFO</span
        >
        <span
          v-if="
            (item.type === 'folder' && hasPosterFile(item)) ||
            (item.type === 'video' && hasVideoPosterFile(item))
          "
          :style="{ fontSize: '10px' }"
          class="px-1 py-0.5 bg-green-600 text-green-100 rounded"
        >
          海报
        </span>
        <span
          v-if="
            (item.type === 'folder' && hasFanartFile(item)) ||
            (item.type === 'video' && hasVideoFanartFile(item))
          "
          :style="{ fontSize: '10px' }"
          class="px-1 py-0.5 bg-blue-600 text-blue-100 rounded"
        >
          艺术图
        </span>
      </div>
    </div>
    <div>
      <svg
        class="w-5 h-5 text-gray-400"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fill-rule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
          clip-rule="evenodd"
        ></path>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MenuItem } from '../../hooks/useContextMenu'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { TMDB_IMG_URL } from '../../api/tmdb'
import type { ProcessedItem } from '../../type'

// 本地Props接口定义
interface Props {
  item: ProcessedItem
  index: number
  selectedIndex: number
  menuBackgroundColor: string
  isMultiSelectMode?: boolean
  isSelected?: boolean
}

// 处理图片加载错误
// const handleImageError = (event: Event): void => {
//   const target = event.target as HTMLImageElement | null;
//   if (target) {
//     target.style.display = "none";
//   }
// };

// 检查视频文件是否有对应的NFO文件
const hasVideoNfoFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'video' || !item.files) return false

  // 检查同目录下是否有任何NFO文件
  // 对于视频文件，只要同目录下有NFO文件就认为有对应的NFO
  return item.files.some(file => {
    const fileName = file.name.toLowerCase()

    return fileName.endsWith('.nfo')
  })
}

// 检查视频文件是否有对应的海报文件
const hasVideoPosterFile = (item: ProcessedItem): boolean => {
  if (item.type !== 'video' || !item.files) return false

  // 获取视频文件的基础名称（不含扩展名）
  const videoBaseName = item.name.replace(/\.[^/.]+$/, '').toLowerCase()

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
  const videoBaseName = item.name.replace(/\.[^/.]+$/, '').toLowerCase()

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

// 定义emit事件
const emit = defineEmits<{
  select: [item: ProcessedItem, index: number]
  refresh: [targetPath?: string]
  showSearchModal: [item: ProcessedItem]
  autoScrape: [item: ProcessedItem]
  toggleSelection: [item: ProcessedItem, index: number]
  manualScrape: [item: ProcessedItem]
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

// 静态图片菜单
const folderMenuItems: MenuItem[] = [
  { id: 'view', label: '刮削', icon: 'fas fa-eye' },
  { id: 'manual_scrape', label: '手动匹配', icon: 'fas fa-keyboard' },
  { id: 'refresh', label: '刷新', icon: 'fas fa-sync-alt' },
]

const handleFileAction = (action: MenuItem, item: ProcessedItem): void => {
  console.log(action.id)
  if (action.id === 'view') {
    console.log(item.name)
    // 自动刮削功能 - 发送事件到父组件处理
    emit('autoScrape', item)
  } else if (action.id === 'manual_scrape') {
    // 手动匹配
    emit('manualScrape', item)
  } else if (action.id === 'refresh') {
    // 刷新当前文件夹
    const folderPath = getParentFolderPath(item)

    emit('refresh', folderPath)
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
    // 如果是视频文件，返回其父目录路径（通过字符串操作获取）
    const pathParts = item.path.split('/')

    pathParts.pop() // 移除文件名
    return pathParts.join('/')
  }
}

// 刮削功能已移至父组件处理

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
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
