<template>
  <!-- 手动匹配弹窗 -->
  <Modal
    v-model:open="visible"
    title="手动匹配电影"
    :width="500"
    ok-text="搜索"
    cancel-text="取消"
    @ok="performManualSearch"
    @cancel="handleCancel"
  >
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2"> 电影名称 </label>
        <Input
          v-model:value="searchInput"
          placeholder="请输入电影名称进行搜索"
          class="w-full"
          @press-enter="performManualSearch"
        />
      </div>
      <div v-if="currentItem" class="text-sm text-gray-500">
        <p>当前项目: {{ currentItem.name }}</p>
        <p class="text-xs mt-1">提示：您可以修改上面的名称来获得更准确的搜索结果</p>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input, Modal, message } from 'ant-design-vue'
import { tmdb, TMDB_IMG_URL } from '../api/tmdb'
import type { Movie } from '@tdanks2000/tmdb-wrapper'

// 接口定义
interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: any[]
}

// Props定义
interface Props {
  visible: boolean
  currentItem: ProcessedItem | null
}

const props = defineProps<Props>()

// Emits定义
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'search-results': [movies: Movie[]]
  'cancel': []
}>()

// 响应式数据
const searchInput = ref('')
const visible = ref(false)

// 监听props变化
watch(() => props.visible, (newVal) => {
  visible.value = newVal
  if (newVal && props.currentItem) {
    searchInput.value = props.currentItem.name
  }
})

watch(visible, (newVal) => {
  emit('update:visible', newVal)
})

/**
 * 清理电影名称，移除不必要的字符和信息
 * @param movieName 原始电影名称
 * @returns 清理后的电影名称
 */
const handleSearchParams = (movieName: string): string => {
  let cleanName = movieName

  // 1. 移除文件扩展名
  cleanName = cleanName.replace(/\.[^.]*$/, '')

  // 2. 移除常见的视频质量标识
  const qualityPatterns = [
    /\b(4K|2160p|1080p|720p|480p|360p)\b/gi,
    /\b(UHD|HD|SD|CAM|TS|TC|SCR|R5|DVDRip|BRRip|BluRay|WEBRip|HDTV)\b/gi,
    /\b(x264|x265|H264|H265|HEVC|AVC)\b/gi,
    /\b(AAC|AC3|DTS|MP3|FLAC)\b/gi,
    /\b(5\.1|7\.1|2\.0)\b/gi,
  ]

  qualityPatterns.forEach(pattern => {
    cleanName = cleanName.replace(pattern, ' ')
  })

  // 3. 移除发布组信息（通常在方括号或圆括号中）
  cleanName = cleanName.replace(/\[[^\]]*\]/g, ' ')
  cleanName = cleanName.replace(/\([^)]*(?:rip|cam|ts|tc|scr|r5|web|hdtv)[^)]*\)/gi, ' ')

  // 4. 移除常见的分隔符和替换为空格
  cleanName = cleanName.replace(/[._-]/g, ' ')

  // 5. 移除多余的空格
  cleanName = cleanName.replace(/\s+/g, ' ').trim()

  // 6. 提取年份（保留用于后续处理）
  const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? yearMatch[0] : ''

  // 7. 移除年份周围的括号
  cleanName = cleanName.replace(/\(\s*(19|20)\d{2}\s*\)/g, ` ${year} `)

  // 8. 移除常见的无用词汇
  const uselessWords = [
    'complete',
    'proper',
    'repack',
    'internal',
    'limited',
    'festival',
    'retail',
    'extended',
    'unrated',
    'directors',
    'cut',
    'edition',
    'version',
    'remastered',
    'criterion',
    'collection',
    'anthology',
    'series',
    'season',
    'episode',
    'disc',
    'cd1',
    'cd2',
    'part1',
    'part2',
    'pt1',
    'pt2',
  ]

  const uselessPattern = new RegExp(`\\b(${uselessWords.join('|')})\\b`, 'gi')
  cleanName = cleanName.replace(uselessPattern, ' ')

  // 9. 移除数字序列（如果不是年份）
  cleanName = cleanName.replace(/\b\d{3,}(?!\d*\b(19|20)\d{2}\b)\b/g, ' ')

  // 10. 移除单独的数字和字母
  cleanName = cleanName.replace(/\b[a-zA-Z]\b/g, ' ')
  cleanName = cleanName.replace(/\b\d{1,2}\b(?!\d)/g, ' ')

  // 11. 再次提取年份（可能在清理过程中位置发生变化）
  const finalYearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
  const finalYear = finalYearMatch ? finalYearMatch[0] : ''

  // 12. 将点号替换为空格（常见于英文电影文件名）
  cleanName = cleanName.replace(/\./g, ' ')

  // 13. 移除特殊字符，保留字母、数字、空格和中文
  cleanName = cleanName.replace(/[^a-zA-Z0-9\s\u4e00-\u9fa5]/g, ' ')

  // 14. 清理多余空格
  cleanName = cleanName.replace(/\s+/g, ' ').trim()

  // 15. 如果有年份，确保年份在末尾
  if (finalYear) {
    cleanName = cleanName.replace(new RegExp(`\\b${finalYear}\\b`, 'g'), '').trim()
    cleanName += ` ${finalYear}`
  }

  return cleanName || movieName // 如果清理后为空，返回原始名称
}

/**
 * 执行手动搜索
 */
const performManualSearch = async (): Promise<void> => {
  if (!searchInput.value.trim()) {
    message.error('请输入电影名称')
    return
  }

  try {
    const cleanName = handleSearchParams(searchInput.value)

    console.log('原始输入:', searchInput.value)
    console.log('清理后名称:', cleanName)

    if (!cleanName) {
      message.error('无法解析电影名称')
      return
    }

    // 提取年份信息
    const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined
    const nameWithoutYear = cleanName.replace(/\b(19|20)\d{2}\b/g, '').trim()

    console.log('提取的年份:', year)
    console.log('无年份名称:', nameWithoutYear)

    // 首次搜索：使用清理后的完整名称和年份
    let res = await tmdb.search.movies({
      query: nameWithoutYear || cleanName,
      language: 'zh-CN',
      ...(year && { year }),
    })

    // 只有在没有结果时才进行后续搜索
    if (res.results.length === 0) {
      // 如果有年份，尝试不使用年份搜索
      if (year) {
        console.log('尝试无年份搜索:', nameWithoutYear)
        res = await tmdb.search.movies({
          query: nameWithoutYear,
          language: 'zh-CN',
        })
      }

      // 如果还是没有结果，尝试英文搜索
      if (res.results.length === 0) {
        console.log('尝试英文搜索:', nameWithoutYear || cleanName)
        res = await tmdb.search.movies({
          query: nameWithoutYear || cleanName,
          language: 'en-US',
          ...(year && { year }),
        })
      }
    }

    if (res.results.length === 0) {
      message.error('未找到该电影')
      return
    }

    // 处理搜索结果
    const movies = res.results.map((movie: Movie) => ({
      ...movie,
      poster_path: movie.poster_path ? TMDB_IMG_URL + movie.poster_path : null,
      id: movie.id as number,
    }))

    console.log('搜索结果:', movies)

    // 关闭手动匹配弹窗
    visible.value = false
    searchInput.value = ''

    // 发送搜索结果到父组件
    emit('search-results', movies)
    message.success(`找到 ${movies.length} 个匹配结果`)
  } catch (error) {
    console.error('搜索电影时出错:', error)
    message.error('搜索电影时出错')
  }
}

/**
 * 取消手动匹配
 */
const handleCancel = (): void => {
  visible.value = false
  searchInput.value = ''
  emit('cancel')
}
</script>