<template>
  <div class="tv-page h-full flex">
   111
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue'
/**
 * 文件项接口
 */
interface FileItem {
  name: string
  path: string
  size: number
  isDirectory: boolean
  isFile: boolean
}

/**
 * 处理后的项目接口
 */
interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: FileItem[]
}

/**
 * 季信息接口
 */
interface Season {
  number: number
  title?: string
  episodeCount?: number
  year?: string
  plot?: string
}

/**
 * 电视剧信息接口
 */
interface TVInfoType {
  title: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actors?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
  seasons?: Season[]
}

/**
 * 搜索结果接口
 */
interface SearchResult {
  id: number
  title: string
  year?: string
  overview?: string
  poster_path?: string
}

// 响应式数据
const leftPanelWidth = ref(400)
const rightPanelWidth = ref(500)
const minPanelWidth = ref(300)
const menuBackgroundColor = ref('rgba(0, 0, 0, 0.8)')

const processedItems = ref<ProcessedItem[]>([])
const selectedIndex = ref<number>(-1)
const isMultiSelectMode = ref(false)
const selectedIndices = ref<number[]>([])

const tvInfo = ref<TVInfoType | null>(null)
const posterUrl = ref('')
const loading = ref(false)

const showSearchModal = ref(false)
const searchResults = ref<SearchResult[]>([])
const searchLoading = ref(false)

// 计算属性
const selectedItem = computed(() => {
  if (selectedIndex.value >= 0 && selectedIndex.value < processedItems.value.length) {
    return processedItems.value[selectedIndex.value]
  }
  return null
})

const selectedItemsSet = computed(() => {
  return new Set(selectedIndices.value)
})

// 注入布局方法
const appLayoutMethods = inject('appLayoutMethods') as {
  setGlobalBackground: (backgroundImage: string, menuBackgroundColor: string) => void
  clearGlobalBackground: () => void
} | null

/**
 * 处理选择项目
 * @param item - 选中的项目
 * @param index - 项目索引
 */
const handleSelectItem = (item: ProcessedItem, index: number): void => {
  selectedIndex.value = index
  // TODO: 加载电视剧信息
  loadTVInfo()
}

/**
 * 处理切换多选模式
 */
const handleToggleMultiSelect = (): void => {
  isMultiSelectMode.value = !isMultiSelectMode.value
  if (!isMultiSelectMode.value) {
    selectedIndices.value = []
  }
}

/**
 * 处理多选项目
 * @param item - 选中的项目
 * @param index - 项目索引
 */
const handleMultiSelectItem = (item: ProcessedItem, index: number): void => {
  const existingIndex = selectedIndices.value.indexOf(index)
  if (existingIndex > -1) {
    selectedIndices.value.splice(existingIndex, 1)
  } else {
    selectedIndices.value.push(index)
  }
}

/**
 * 处理搜索电视剧
 * @param query 搜索关键词
 */
const handleSearchTV = (query: string): void => {
  console.log('搜索电视剧:', query)
  // TODO: 实现电视剧搜索逻辑
  searchResults.value = []
  showSearchModal.value = true
}

/**
 * 处理关闭搜索弹窗
 */
const handleCloseSearchModal = (): void => {
  showSearchModal.value = false
  searchResults.value = []
}

/**
 * 处理选择搜索结果
 * @param result - 搜索结果
 */
const handleSelectSearchResult = (result: SearchResult): void => {
  console.log('选择搜索结果:', result)
  // TODO: 处理选择的搜索结果
  handleCloseSearchModal()
}

/**
 * 处理下载海报
 */
const handleDownloadPoster = (): void => {
  console.log('下载海报')
  // TODO: 实现海报下载逻辑
}

/**
 * 加载电视剧信息
 */
const loadTVInfo = (): void => {
  if (!selectedItem.value) return
  
  loading.value = true
  // TODO: 实现电视剧信息加载逻辑
  
  // 模拟加载
  setTimeout(() => {
    tvInfo.value = {
      title: selectedItem.value?.name || '未知电视剧',
      year: '2023',
      plot: '这是一个示例电视剧的剧情描述...',
      genre: ['剧情', '科幻'],
      director: '示例导演',
      actors: ['演员A', '演员B', '演员C'],
      rating: '8.5',
      runtime: '45分钟',
      country: '美国',
      studio: '示例制片公司',
      premiered: '2023-01-01',
      seasons: [
        {
          number: 1,
          title: '第一季',
          episodeCount: 10,
          year: '2023',
          plot: '第一季的剧情描述...'
        },
        {
          number: 2,
          title: '第二季',
          episodeCount: 12,
          year: '2024',
          plot: '第二季的剧情描述...'
        }
      ]
    }
    loading.value = false
  }, 1000)
}

/**
 * 处理全选/取消全选
 */
const handleToggleSelectAll = (): void => {
  if (selectedIndices.value.length === processedItems.value.length) {
    // 当前全选状态，取消全选
    selectedIndices.value = []
  } else {
    // 当前非全选状态，执行全选
    selectedIndices.value = processedItems.value.map((_, index) => index)
  }
}

/**
 * 处理添加选中项到队列
 */
const handleAddSelectedToQueue = (): void => {
  console.log('添加选中项到队列:', selectedIndices.value)
  // TODO: 实现添加到队列逻辑
}

/**
 * 处理刷新
 * @param targetPath - 目标路径
 */
const handleRefresh = (targetPath?: string): void => {
  console.log('刷新:', targetPath)
  // TODO: 实现刷新逻辑
  initializeData()
}

/**
 * 处理显示队列
 */
const handleShowQueue = (): void => {
  console.log('显示队列')
  // TODO: 实现显示队列逻辑
}

/**
 * 处理手动抓取
 * @param item - 项目
 */
const handleManualScrape = (item: ProcessedItem): void => {
  console.log('手动抓取:', item)
  // TODO: 实现手动抓取逻辑
}

/**
 * 处理自动抓取
 * @param item - 项目
 */
const handleAutoScrape = (item: ProcessedItem): void => {
  console.log('自动抓取:', item)
  // TODO: 实现自动抓取逻辑
}

/**
 * 初始化数据
 */
const initializeData = (): void => {
  // TODO: 加载文件列表
  processedItems.value = [
    {
      name: '示例电视剧文件夹',
      path: '/path/to/tv/show',
      type: 'folder',
      fileCount: 24,
      files: []
    }
  ]
}

// 组件挂载完成后执行
onMounted(() => {
  initializeData()
})
</script>

<style scoped>
.tv-page {
  background: transparent;
}
</style>
