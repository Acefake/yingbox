<template>
  <div
    v-context-menu="{
      menuItems: menuItems,
      data: item,
      onItemClick: handleFileAction,
      onBeforeShow: handleRightClick,
    }"
    :class="[
      'flex items-center py-1 px-2 rounded cursor-pointer mb-0.5',
      isSelected ? 'selected-item' : 'hover:bg-gray-700',
    ]"
    :style="isSelected ? selectedStyle : undefined"
    @click="handleItemClick"
    @mouseenter="handleMouseEnter"
  >
    <div class="flex-1 min-w-0 flex items-center gap-1">
      <div class="text-xs font-medium text-white truncate flex-1">
        {{ item.name }}
      </div>
      <div class="flex gap-0.5 flex-shrink-0" v-if="hasStatus">
        <span v-if="statusFlags.nfo" class="status-tag bg-yellow-600 text-yellow-100">N</span>
        <span v-if="statusFlags.poster" class="status-tag bg-green-600 text-green-100">P</span>
        <span v-if="statusFlags.fanart" class="status-tag bg-blue-600 text-blue-100">A</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MenuItem } from '@/composables/use-context-menu'
import type { ProcessedItem } from '@/types'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { IMAGE_EXTENSIONS_SET } from '@/constants/media'

interface Props {
  item: ProcessedItem
  index: number
  selectedIndex: number
  selectedPath?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  select: [item: ProcessedItem, index: number]
  showSearchModal: [item: ProcessedItem]
  autoScrape: [item: ProcessedItem]
  directScrape: [item: ProcessedItem]
  manualScrape: [item: ProcessedItem]
  preload: [item: ProcessedItem]
  localScrape: [item: ProcessedItem]
  downloadVideo: [item: ProcessedItem]
  fetchMeta: [item: ProcessedItem]
  play: [item: ProcessedItem]
  deleteFile: [item: ProcessedItem]
}>()

// 选中状态 - 极简判断
const isSelected = computed(() => props.selectedIndex === props.index)
const selectedStyle = { backgroundColor: 'rgba(255, 255, 255, 0.2)' }

// 预计算状态标志 - 使用 Set 提升查找性能
const statusFlags = computed(() => {
  const item = props.item
  const files = item.files
  if (!files || files.length === 0) {
    return { nfo: false, poster: false, fanart: false }
  }

  const baseName = item.type === 'video'
    ? item.name.replace(/\.[^/.]+$/, '').toLowerCase()
    : item.name.toLowerCase()

  let nfo = false
  let poster = false
  let fanart = false

  for (const file of files) {
    const name = file.name.toLowerCase()
    const ext = name.substring(name.lastIndexOf('.'))

    // NFO 检查
    if (!nfo && ext === '.nfo') {
      if (item.type === 'video') {
        nfo = name.includes(baseName)
      } else {
        nfo = true
      }
    }

    // 海报检查
    if (!poster && IMAGE_EXTENSIONS_SET.has(ext)) {
      if (item.type === 'video') {
        poster = name.includes(baseName) ||
          name === 'poster.jpg' || name === 'folder.jpg' || name === 'movie.jpg'
      } else {
        poster = name.includes('poster') || name.includes('cover') ||
          name.includes('folder') || name === 'poster.jpg' || name === 'folder.jpg'
      }
    }

    // Fanart 检查
    if (!fanart && IMAGE_EXTENSIONS_SET.has(ext)) {
      if (item.type === 'video') {
        fanart = name.includes(`${baseName}-fanart`) || name === 'fanart.jpg'
      } else {
        fanart = name.includes('fanart') || name.includes('backdrop') || name === 'fanart.jpg'
      }
    }

    // 提前退出
    if (nfo && poster && fanart) break
  }

  return { nfo, poster, fanart }
})

const hasStatus = computed(() => {
  const f = statusFlags.value
  return f.nfo || f.poster || f.fanart
})

// 右键菜单 - 使用 shallowRef 避免深度响应式
const { items: queueItems } = useGlobalQueue()
const menuItems = computed<MenuItem[]>(() => {
  const isQueued = queueItems.value.some(
    i => i.name === props.item.name && (i.status === 'pending' || i.status === 'processing')
  )
  const config = getScrapeProviderConfig()
  const items: MenuItem[] = []

  if (!isQueued) {
    items.push({ id: 'view', label: '刮削', icon: 'fas fa-eye' })
  }
  items.push({ id: 'play', label: '播放', icon: 'fas fa-play' })
  items.push({ id: 'delete', label: '删除', icon: 'fas fa-trash' })

  if (!isQueued && config.provider === 'javbus') {
    items.push(
      { id: 'fetch-meta', label: '预览元数据' },
      { id: 'download', label: '下载视频' }
    )
  }

  return items
})

const handleItemClick = (): void => {
  emit('select', props.item, props.index)
}

const handleRightClick = (): void => {
  emit('select', props.item, props.index)
}

const handleMouseEnter = (): void => {
  if (props.item.type === 'folder') {
    emit('preload', props.item)
  }
}

const handleFileAction = (action: MenuItem, item: ProcessedItem): void => {
  if (action.id === 'view') {
    emit('autoScrape', item)
  } else if (action.id === 'play') {
    emit('play', item)
  } else if (action.id === 'delete') {
    emit('deleteFile', item)
  } else if (action.id === 'local-scrape') {
    emit('localScrape', item)
  } else if (action.id === 'fetch-meta') {
    emit('fetchMeta', item)
  } else if (action.id === 'download') {
    emit('downloadVideo', item)
  }
}
</script>

<style scoped>
.selected-item {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
}
</style>
