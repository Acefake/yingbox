<template>
  <div ref="leftPanel" class="yb-media-sidebar left-panel">
    <!-- Header -->
    <div class="lp-header">
      <div class="lp-title-block">
        <div class="lp-title-row">
          <h2 class="yb-page-title lp-title">
            {{ mode === 'tv' ? '电视剧' : '电影' }}
          </h2>
          <span v-if="adultMode" class="lp-adult">18+</span>
        </div>
        <p class="yb-section-subtitle lp-sub">本地媒体库</p>
      </div>

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
        <button
          class="yb-btn-primary"
          :disabled="dirLoading"
          @click="$emit('addFolder')"
        >
          添加文件夹
        </button>
        <button
          class="yb-btn-soft"
          :disabled="dirLoading"
          @click="$emit('refresh')"
        >
          {{ dirLoading ? '刷新中…' : '刷新' }}
        </button>
        <span v-if="processedItems.length" class="lp-count">{{ processedItems.length }} 项</span>
      </div>

      <!-- Directory chips -->
      <div v-if="directoryPaths?.length" class="lp-dirs">
        <div v-for="(dir, i) in directoryPaths" :key="dir" class="lp-dir group">
          <span class="lp-dir-name" :title="dir">{{ dir.split(/[/\\]/).pop() }}</span>
          <button
            class="lp-dir-remove"
            :aria-label="`移除目录 ${dir}`"
            @click="$emit('removeDirectory', i)"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Secondary: scrape all (Apple / soft accent pill) -->
      <button
        v-if="mode !== 'tv' && unscrapedCount > 0"
        class="lp-scrape-all"
        type="button"
        @click="$emit('scrapeAll')"
      >
        <span class="lp-scrape-all-label">刮削未匹配</span>
        <span class="lp-scrape-all-badge">{{ unscrapedCount }}</span>
      </button>
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
const adultMode = ref(localStorage.getItem('adultMode') === '1')
watch(
  () => route.query.q,
  query => { searchQuery.value = typeof query === 'string' ? query : '' },
  { immediate: true }
)
const syncAdultMode = () => { adultMode.value = localStorage.getItem('adultMode') === '1' }
const onAdultModeChange = () => syncAdultMode()
const onStorageChange = (event: StorageEvent) => {
  if (event.key === 'adultMode') syncAdultMode()
}

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
    (visibleMovieRange.value.total - visibleMovieRange.value.end) * movieRowHeight
)

const handleListScroll = (event: Event): void => {
  listScrollTop.value = (event.target as HTMLElement).scrollTop
}

const syncListViewport = (): void => {
  listViewportHeight.value = listViewport.value?.clientHeight || 0
}

onMounted(() => {
  window.addEventListener('adultModeChange', onAdultModeChange)
  window.addEventListener('storage', onStorageChange)
  void nextTick(() => {
    syncListViewport()
    if (!listViewport.value) return
    listResizeObserver = new ResizeObserver(syncListViewport)
    listResizeObserver.observe(listViewport.value)
  })
})

onBeforeUnmount(() => {
  listResizeObserver?.disconnect()
  window.removeEventListener('adultModeChange', onAdultModeChange)
  window.removeEventListener('storage', onStorageChange)
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
    if (!item.files || !item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))) {
      count++
    }
  }
  return count
})
</script>

<style scoped>
.lp-header {
  flex-shrink: 0;
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--separator);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.lp-title-block {
  padding-inline: 2px;
}

.lp-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.lp-title {
  font-size: var(--text-xl);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.lp-sub {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.lp-adult {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 36%, transparent);
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
  padding: 4px 10px;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
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
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: var(--transition-fast);
}

.lp-dir:hover .lp-dir-remove,
.lp-dir:focus-within .lp-dir-remove {
  opacity: 1;
}

.lp-dir-remove:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.lp-scrape-all {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: var(--control-height-sm);
  padding: 0 12px 0 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: var(--transition-fast);
  text-align: left;
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--accent) 12%, transparent);
}

.lp-scrape-all-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-scrape-all-badge {
  flex-shrink: 0;
  min-width: 22px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}

.lp-scrape-all:hover {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  border-color: color-mix(in srgb, var(--accent) 34%, transparent);
}

.lp-scrape-all:active {
  transform: scale(0.98);
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
  border-radius: 999px;
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
  to { transform: rotate(360deg); }
}

@keyframes lp-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .lp-spin,
  .lp-scan-bar,
  .lp-scrape-all:active {
    animation: none;
    transform: none;
  }
}
</style>
