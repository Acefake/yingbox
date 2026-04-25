<template>
  <div class="tv-file-tree-item">
    <!-- 当前项展示（剧、季、或集） -->
    <div
      v-context-menu="depth === 0 ? { menuItems: tvMenuItems, data: item, onItemClick: handleTVAction, onBeforeShow: handleRightClick } : undefined"
      @click="handleItemClick"
      @mouseenter="handleMouseEnter"
      :class="[
        'flex items-center py-1 px-2 rounded cursor-pointer transition-all duration-200 mb-0.5 group',
        isMultiSelectedItem ? 'bg-blue-600 bg-opacity-30' : isSelected ? 'bg-white bg-opacity-10' : 'hover:bg-gray-700'
      ]"
      :style="{ paddingLeft: depth * 12 + 8 + 'px' }"
    >
      <!-- 多选复选框（仅根节点显示）-->
      <div v-if="isMultiSelectMode && depth === 0" class="mr-1.5 flex-shrink-0" @click.stop="handleToggleSelection">
        <div
          class="w-3.5 h-3.5 rounded border flex items-center justify-center transition-all"
          :class="isMultiSelectedItem ? 'bg-blue-600 border-blue-600' : 'border-gray-500 hover:border-blue-400'"
        >
          <svg v-if="isMultiSelectedItem" class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <!-- 展开图标（仅当有子项目时显示） -->
      <div class="w-4 h-4 mr-1 flex items-center justify-center">
        <svg
          v-if="hasChildren"
          class="w-3 h-3 text-gray-400 transition-transform duration-200"
          :class="{ 'rotate-90': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <!-- 图标 -->
      <div class="mr-2 transition-colors" :class="isSelected ? 'text-blue-400' : 'text-gray-400 group-hover:text-blue-400'">
        <!-- 季文件夹图标 -->
        <svg v-if="item.isSeasonFolder" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
        <!-- 普通文件夹图标 -->
        <svg v-else-if="item.type === 'folder'" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <!-- 视频图标 -->
        <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h-2v-2h2zm-2-2h2v-2h-2v2zm-4 4v-2H9v2h2zm-4 0v-2H5v2h2zm-2-4h2v-2H5v2zm8-4v2h2V9h-2z" clip-rule="evenodd" />
        </svg>
      </div>

      <!-- 名称 -->
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate" :class="isSelected ? 'text-blue-400' : 'text-white'">
          {{ item.name }}
        </div>
      </div>

      <!-- 标签 -->
      <div class="flex gap-1 ml-2">
        <span v-if="item.hasNfo" class="tag bg-yellow-600">NFO</span>
        <span v-if="item.hasPoster" class="tag bg-green-600">海报</span>
        <span v-if="item.hasFanart" class="tag bg-blue-600">艺术图</span>
      </div>
    </div>

    <!-- 子项目递归展示（只显示文件夹/季，不显示视频文件） -->
    <div v-if="hasChildren && isExpanded" class="overflow-hidden">
      <TVFileTreeItem
        v-for="(child, idx) in folderChildren"
        :key="child.path"
        :item="child"
        :index="idx"
        :depth="depth + 1"
        :selected-index="selectedIndex"
        :selected-path="selectedPath"
        :root-item="rootItem ?? item"
        @select="(i, root) => $emit('select', i, root)"
        @preload="(i) => $emit('preload', i)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ProcessedItem } from '@/types'
import type { MenuItem } from '@/composables/use-context-menu'

interface Props {
  item: ProcessedItem
  index: number
  depth?: number
  selectedIndex: number
  selectedPath?: string
  /** 根节点（TV show），子节点递归时由父传入，用于刮削时定位show根 */
  rootItem?: ProcessedItem
  isMultiSelectMode?: boolean
  isSelected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
})

const emit = defineEmits<{
  /** item: 被点击项, rootItem: 所属TV show根节点 */
  select: [item: ProcessedItem, rootItem: ProcessedItem]
  /** 预加载事件 */
  preload: [item: ProcessedItem]
  /** 多选切换（仅根节点）*/
  toggleSelection: [item: ProcessedItem]
  /** 自动刮削 */
  autoScrape: [item: ProcessedItem]
  /** 直接刮削 */
  directScrape: [item: ProcessedItem]
  /** 手动匹配 */
  manualScrape: [item: ProcessedItem]
}>()

const isExpanded = ref(props.depth === 0)

const hasChildren = computed(() =>
  props.item.children && props.item.children.some(c => c.type === 'folder')
)

/** 只展示文件夹子项（不展示视频文件） */
const folderChildren = computed(() =>
  (props.item.children || []).filter(c => c.type === 'folder')
)

const isSelected = computed(() => props.selectedPath === props.item.path)
const isMultiSelectedItem = computed(() => props.isSelected ?? false)

const handleItemClick = (): void => {
  if (props.isMultiSelectMode && props.depth === 0) {
    handleToggleSelection()
    return
  }
  if (hasChildren.value) {
    isExpanded.value = !isExpanded.value
  }
  emit('select', props.item, props.rootItem ?? props.item)
}

const handleToggleSelection = (): void => {
  emit('toggleSelection', props.rootItem ?? props.item)
}

const handleRightClick = (): void => {
  if (!isSelected.value) {
    emit('select', props.item, props.rootItem ?? props.item)
  }
}

const tvMenuItems: MenuItem[] = [
  { id: 'direct_scrape', label: '直接刮削', icon: 'fas fa-bolt' },
  { id: 'auto_scrape', label: '刮削（选择匹配）', icon: 'fas fa-search' },
  { id: 'manual_scrape', label: '手动匹配', icon: 'fas fa-keyboard' },
]

const handleTVAction = (action: MenuItem, _item: ProcessedItem): void => {
  const root = props.rootItem ?? props.item
  if (action.id === 'direct_scrape') {
    emit('directScrape', root)
  } else if (action.id === 'auto_scrape') {
    emit('autoScrape', root)
  } else if (action.id === 'manual_scrape') {
    emit('manualScrape', root)
  }
}

const handleMouseEnter = (): void => {
  // 仅对 TV show 根文件夹预加载
  if (props.item.type === 'folder' && props.depth === 0) {
    emit('preload', props.item)
  }
}
</script>

<style scoped>
.tag {
  font-size: 9px;
  padding: 1px 3px;
  border-radius: 2px;
  color: #fff;
  line-height: 1;
  flex-shrink: 0;
}
</style>
