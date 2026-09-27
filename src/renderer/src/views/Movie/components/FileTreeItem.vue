<template>
  <div
    v-context-menu="{
      menuItems: menuItems,
      data: item,
      onItemClick: handleFileAction,
      onBeforeShow: handleRightClick,
    }"
    :class="['file-tree-item', { 'is-selected': isSelected }]"
    @click="handleItemClick"
    @mouseenter="handleMouseEnter"
  >
    <div class="file-tree-row">
      <div class="file-tree-name" :title="item.name">
        {{ displayName }}
      </div>
      <div v-if="hasStatus || isQueued" class="file-tree-flags">
        <span v-if="isQueued" class="status-tag flag-queued">队列</span>
        <span v-if="statusFlags.nfo" class="status-tag flag-nfo">N</span>
        <span v-if="statusFlags.poster" class="status-tag flag-poster">P</span>
        <span v-if="statusFlags.fanart" class="status-tag flag-fanart">A</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MenuItem } from '@/composables/use-context-menu'
import type { ProcessedItem } from '@/types'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { IMAGE_EXTENSIONS_SET } from '@/constants/media'
import { resolveMediaDisplayTitle } from '@/utils/avid'

interface Props {
  item: ProcessedItem
  index: number
  selectedIndex: number
  selectedPath?: string
}

const props = defineProps<Props>()

/** 文件夹保留全名；视频用统一展示标题（metaTitle / cleanSearchParams） */
const displayName = computed(() => {
  if (props.item.type === 'folder') return props.item.name
  return resolveMediaDisplayTitle(props.item)
})

const emit = defineEmits<{
  select: [item: ProcessedItem, index: number]
  /** 打开统一刮削工作台 */
  scrape: [item: ProcessedItem]
  preload: [item: ProcessedItem]
  play: [item: ProcessedItem]
  deleteFile: [item: ProcessedItem]
}>()

// 选中状态 - 极简判断
const isSelected = computed(() => props.selectedIndex === props.index)

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
const isQueued = computed(() =>
  queueItems.value.some(i => {
    if (i.status !== 'pending' && i.status !== 'processing') return false
    if (i.dedupKey && i.dedupKey === props.item.path) return true
    return i.name === props.item.name
  })
)
const menuItems = computed<MenuItem[]>(() => {
  const queued = isQueued.value
  const items: MenuItem[] = []

  if (!queued) {
    items.push({ id: 'scrape', label: '刮削', icon: 'fas fa-magic' })
  }
  items.push({ id: 'play', label: '播放', icon: 'fas fa-play' })
  items.push({ id: 'delete', label: '删除', icon: 'fas fa-trash' })

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
  if (action.id === 'scrape' || action.id === 'view') {
    emit('scrape', item)
  } else if (action.id === 'play') {
    emit('play', item)
  } else if (action.id === 'delete') {
    emit('deleteFile', item)
  }
}
</script>

<style scoped>
.file-tree-item {
  display: flex;
  align-items: center;
  min-height: var(--media-row-height);
  padding: 6px 10px;
  margin-bottom: 1px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.18s var(--ease-out), transform 100ms ease-out;
}

.file-tree-item:hover {
  background: var(--bg-glass-hover);
}

.file-tree-item:active {
  transform: scale(0.985);
}

.file-tree-item.is-selected {
  background: var(--bg-active-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
}

.file-tree-item.is-selected .file-tree-name {
  color: var(--accent-text);
  font-weight: var(--font-weight-semibold);
}

.file-tree-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-tree-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  letter-spacing: -0.01em;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tree-flags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.flag-nfo {
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 36%, transparent);
}

.flag-poster {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 36%, transparent);
}

.flag-fanart {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent-text);
  border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);
}

.flag-queued {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent-text);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  text-transform: none;
  letter-spacing: 0;
}

@media (prefers-reduced-motion: reduce) {
  .file-tree-item:active { transform: none; }
}
</style>
