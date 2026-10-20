<template>
  <div ref="leftPanel" class="yb-media-sidebar left-panel">
    <!-- Header -->
    <div class="lp-header">
      <PageHeader
        :title="mode === 'tv' ? '电视剧' : '电影'"
        description="本地媒体库"
      />

      <!-- Scan progress -->
      <div v-if="dirLoading" class="lp-scan">
        <div class="lp-scan-label">
          <span class="lp-spin" />
          <span v-if="scanProgress?.active">正在扫描…</span>
          <span v-else>正在加载…</span>
        </div>
        <div class="lp-scan-track">
          <div class="lp-scan-bar" />
        </div>
      </div>

      <!-- Primary actions -->
      <div class="yb-media-toolbar lp-actions">
        <UiButton
          icon="plus"
          label="添加目录"
          :disabled="dirLoading"
          @click="$emit('addFolder')"
        />
        <UiIconButton
          icon="refresh"
          label="刷新媒体目录"
          :loading="dirLoading"
          @click="$emit('refresh')"
        />
        <span v-if="processedItems.length" class="lp-count"
          >{{ processedItems.length }} 项</span
        >
      </div>

      <!-- Directory chips -->
      <div v-if="directoryPaths?.length" class="lp-dirs">
        <div v-for="(dir, i) in directoryPaths" :key="dir" class="lp-dir group">
          <span class="lp-dir-name" :title="dir">{{
            dir.split(/[/\\]/).pop()
          }}</span>
          <UiIconButton
            class="lp-dir-remove"
            icon="close"
            size="sm"
            danger
            :label="`移除目录「${dir.split(/[/\\]/).pop()}」`"
            @click="$emit('removeDirectory', i)"
          />
        </div>
      </div>

      <!-- 次要操作：批量刮削未匹配条目 -->
      <UiButton
        v-if="mode !== 'tv' && unscrapedCount > 0"
        class="lp-scrape-all"
        icon="wand"
        size="sm"
        @click="$emit('scrapeAll')"
      >
        刮削未匹配<span class="lp-scrape-all-badge">{{ unscrapedCount }}</span>
      </UiButton>
    </div>

    <!-- Library list -->
    <div
      ref="listViewport"
      class="lp-list primary-scrollbar"
      @scroll.passive="handleListScroll"
    >
      <div v-if="filteredItems.length === 0" class="lp-empty">
        {{ searchQuery ? '没有找到匹配内容' : '请先添加文件夹' }}
      </div>

      <template v-else-if="mode === 'tv'">
        <TVFileTreeItem
          v-for="(item, index) in filteredItems"
          :key="`tv-${item.path}`"
          :item="item"
          :index="index"
          :selected-index="selectedIndex"
          :selected-path="selectedPath"
          @select="
            (item: ProcessedItem, rootItem: ProcessedItem) =>
              $emit('selectItem', item, rootItem)
          "
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @auto-scrape="(item: ProcessedItem) => $emit('autoScrape', item)"
          @direct-scrape="(item: ProcessedItem) => $emit('directScrape', item)"
          @manual-scrape="(item: ProcessedItem) => $emit('manualScrape', item)"
        />
      </template>

      <template v-else>
        <div :style="{ height: `${movieListTopPadding}px` }" />
        <FileTreeItem
          v-for="entry in visibleMovieItems"
          :key="`movie-${entry.item.path}`"
          :item="entry.item"
          :index="entry.index"
          :selected-index="selectedIndex"
          :selected-path="selectedPath"
          @select="$emit('selectItem', entry.item, entry.index)"
          @scrape="item => $emit('scrape', item)"
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @play="(item: ProcessedItem) => $emit('play', item)"
          @delete-file="(item: ProcessedItem) => $emit('deleteFile', item)"
        />
        <div :style="{ height: `${movieListBottomPadding}px` }" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import FileTreeItem from '@/views/Movie/components/FileTreeItem.vue'
import TVFileTreeItem from '@/views/TV/components/TVFileTreeItem.vue'
import { ProcessedItem } from '@/types'
interface Props {
  processedItems: ProcessedItem[]
  selectedIndex: number
  dirLoading: boolean
  mode?: 'movie' | 'tv'
  directoryPaths?: string[]
  scanProgress?: { found: number; active: boolean }
  selectedPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'movie',
})

const route = useRoute()
const searchQuery = ref('')
watch(
  () => route.query.q,
  query => {
    searchQuery.value = typeof query === 'string' ? query : ''
  },
  { immediate: true }
)
defineEmits<{
  refresh: []
  addFolder: []
  removeDirectory: [index: number]
  clearCache: []
  selectItem: [item: ProcessedItem, rootItem: ProcessedItem | number]
  scrape: [item: ProcessedItem]
  /** TV / 旧入口兼容 */
  autoScrape: [item: ProcessedItem]
  directScrape: [item: ProcessedItem]
  manualScrape: [item: ProcessedItem]
  preload: [item: ProcessedItem]
  play: [item: ProcessedItem]
  deleteFile: [item: ProcessedItem]
  scrapeAll: []
}>()

const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.processedItems
  }

  const query = searchQuery.value.toLowerCase()
  const items = props.processedItems
  const len = items.length
  const result: ProcessedItem[] = []

  for (let i = 0; i < len; i++) {
    const item = items[i]
    const name = item.name.toLowerCase()

    if (name.includes(query)) {
      result.push(item)
      continue
    }

    if (item.path.toLowerCase().includes(query)) {
      result.push(item)
      continue
    }

    if (item.type === 'folder' && item.files) {
      const files = item.files
      for (let j = 0; j < files.length; j++) {
        if (files[j].name.toLowerCase().includes(query)) {
          result.push(item)
          break
        }
      }
    }
  }

  return result
})

const listViewport = ref<HTMLElement | null>(null)
const listScrollTop = ref(0)
const listViewportHeight = ref(0)
const movieRowHeight = 36
const movieOverscan = 10
let listResizeObserver: ResizeObserver | undefined

const visibleMovieRange = computed(() => {
  const total = filteredItems.value.length
  const start = Math.max(
    0,
    Math.floor(listScrollTop.value / movieRowHeight) - movieOverscan
  )
  const visibleCount = Math.ceil(listViewportHeight.value / movieRowHeight)
  const end = Math.min(total, start + visibleCount + movieOverscan * 2)
  return { start, end, total }
})

const visibleMovieItems = computed(() => {
  const { start, end } = visibleMovieRange.value
  return filteredItems.value.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset,
  }))
})

const movieListTopPadding = computed(
  () => visibleMovieRange.value.start * movieRowHeight
)
const movieListBottomPadding = computed(
  () =>
    (visibleMovieRange.value.total - visibleMovieRange.value.end) *
    movieRowHeight
)

const handleListScroll = (event: Event): void => {
  listScrollTop.value = (event.target as HTMLElement).scrollTop
}

const syncListViewport = (): void => {
  listViewportHeight.value = listViewport.value?.clientHeight || 0
}

onMounted(() => {
  void nextTick(() => {
    syncListViewport()
    if (!listViewport.value) return
    listResizeObserver = new ResizeObserver(syncListViewport)
    listResizeObserver.observe(listViewport.value)
  })
})

onBeforeUnmount(() => {
  listResizeObserver?.disconnect()
})

watch(filteredItems, () => {
  listScrollTop.value = 0
  listViewport.value?.scrollTo({ top: 0 })
})

const unscrapedCount = computed(() => {
  const items = props.processedItems
  let count = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (
      !item.files ||
      !item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))
    ) {
      count++
    }
  }
  return count
})
</script>

<style scoped>
.lp-header {
  flex-shrink: 0;
  padding: 24px 18px 18px;
  border-bottom: 1px solid var(--separator);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lp-actions {
  gap: var(--space-2);
}

.lp-count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.lp-dirs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 72px;
  overflow-y: auto;
}

.lp-dir {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 2px 2px 10px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);

  border: 1px solid var(--border-subtle);
}

.lp-dir-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-dir-remove {
  opacity: 0;
}

.lp-dir:hover .lp-dir-remove,
.lp-dir:focus-within .lp-dir-remove {
  opacity: 1;
}

.lp-scrape-all {
  width: 100%;
}

.lp-scrape-all-badge {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.lp-scan-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--accent-text);
  margin-bottom: 6px;
}

.lp-spin {
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: lp-spin 0.8s linear infinite;
}

.lp-scan-track {
  height: 3px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--bg-fill-secondary);
}

.lp-scan-bar {
  width: 55%;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent) 60%, transparent);
  animation: lp-pulse 1.4s ease-in-out infinite;
}

.lp-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
}

.lp-empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

@keyframes lp-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes lp-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lp-spin,
  .lp-scan-bar {
    animation: none;
  }
}
</style>
