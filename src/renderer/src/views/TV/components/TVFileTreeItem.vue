<template>
  <div class="tv-file-tree-item">
    <!-- 当前项展示（剧、季、或集） -->
    <div
      v-context-menu="
        depth === 0
          ? {
              menuItems: tvMenuItems,
              data: item,
              onItemClick: handleTVAction,
              onBeforeShow: handleRightClick,
            }
          : undefined
      "
      class="tv-row group"
      :class="{
        'is-multi-selected': isMultiSelectedItem,
        'is-selected': !isMultiSelectedItem && isSelected,
      }"
      :style="{ paddingLeft: depth * 12 + 8 + 'px' }"
      @click="handleItemClick"
    >
      <!-- 多选复选框（仅根节点显示）-->
      <div
        v-if="isMultiSelectMode && depth === 0"
        class="tv-checkbox-wrap"
        @click.stop="handleToggleSelection"
      >
        <div
          class="tv-checkbox"
          :class="{ 'is-checked': isMultiSelectedItem }"
        >
          <svg
            v-if="isMultiSelectedItem"
            class="tv-checkbox-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="3"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>

      <!-- 展开图标（仅当有子项目时显示） -->
      <div class="tv-expand">
        <svg
          v-if="hasChildren"
          class="tv-expand-icon"
          :class="{ 'is-open': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="3"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>

      <!-- 图标 -->
      <div
        class="tv-type-icon"
        :class="{ 'is-active': isSelected }"
      >
        <!-- 季文件夹图标 -->
        <svg
          v-if="item.isSeasonFolder"
          class="w-4 h-4"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"
          />
        </svg>
        <!-- 普通文件夹图标 -->
        <svg
          v-else-if="item.type === 'folder'"
          class="w-5 h-5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
          />
        </svg>
        <!-- 视频图标 -->
        <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h-2v-2h2zm-2-2h2v-2h-2v2zm-4 4v-2H9v2h2zm-4 0v-2H5v2h2zm-2-4h2v-2H5v2zm8-4v2h2V9h-2z"
            clip-rule="evenodd"
          />
        </svg>
      </div>

      <!-- 名称 -->
      <div class="tv-name-wrap">
        <div
          class="tv-name"
          :class="{ 'is-active': isSelected }"
          :title="item.name"
        >
          {{ displayName }}
        </div>
      </div>

      <!-- 标签 -->
      <div class="tv-flags">
        <span v-if="item.hasNfo" class="status-tag flag-nfo">N</span>
        <span v-if="item.hasPoster" class="status-tag flag-poster">P</span>
        <span v-if="item.hasFanart" class="status-tag flag-fanart">A</span>
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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProcessedItem } from '@/types'
import type { MenuItem } from '@/composables/use-context-menu'
import { stripMediaExtension } from '@/utils/avid'

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
  depth: 0,
})

const emit = defineEmits<{
  /** item: 被点击项, rootItem: 所属TV show根节点 */
  select: [item: ProcessedItem, rootItem: ProcessedItem]
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

const hasChildren = computed(
  () =>
    props.item.children && props.item.children.some(c => c.type === 'folder')
)

/** 只展示文件夹子项（不展示视频文件） */
const folderChildren = computed(() =>
  (props.item.children || []).filter(c => c.type === 'folder')
)

const isSelected = computed(() => props.selectedPath === props.item.path)
const isMultiSelectedItem = computed(() => props.isSelected ?? false)

/** 文件夹保留全名；视频文件去掉常见扩展名 */
const displayName = computed(() => {
  if (props.item.type === 'folder') return props.item.name
  return stripMediaExtension(props.item.name)
})

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
  { id: 'direct_scrape', label: '刮削', icon: 'fas fa-bolt' },
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

</script>

<style scoped>
.tv-row {
  display: flex;
  align-items: center;
  min-height: var(--media-row-height);
  padding-top: 6px;
  padding-bottom: 6px;
  padding-right: 10px;
  margin-bottom: 1px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.18s var(--ease-out), transform 100ms ease-out;
}

.tv-row:hover {
  background: var(--bg-glass-hover);
}

.tv-row:active {
  transform: scale(0.985);
}

.tv-row.is-selected {
  background: var(--bg-active-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
}

.tv-row.is-multi-selected {
  background: var(--bg-active-soft);
}

.tv-checkbox-wrap {
  margin-right: 6px;
  flex-shrink: 0;
}

.tv-checkbox {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition-fast);
}

.tv-checkbox:hover {
  border-color: var(--accent);
}

.tv-checkbox.is-checked {
  background: var(--accent);
  border-color: var(--accent);
}

.tv-checkbox-icon {
  width: 10px;
  height: 10px;
  color: var(--text-on-accent);
}

.tv-expand {
  width: 16px;
  height: 16px;
  margin-right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tv-expand-icon {
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
  transition: transform 0.2s var(--ease-out);
}

.tv-expand-icon.is-open {
  transform: rotate(90deg);
}

.tv-type-icon {
  margin-right: 8px;
  color: var(--text-tertiary);
  transition: color 0.18s var(--ease-out);
}

.tv-row:hover .tv-type-icon,
.tv-type-icon.is-active {
  color: var(--accent-text);
}

.tv-name-wrap {
  flex: 1;
  min-width: 0;
}

.tv-name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  letter-spacing: -0.01em;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tv-name.is-active {
  color: var(--accent-text);
}

.tv-flags {
  display: flex;
  gap: 4px;
  margin-left: 8px;
  flex-shrink: 0;
}

.flag-nfo {
  background: color-mix(in srgb, var(--warning) 22%, transparent);
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
}

.flag-poster {
  background: color-mix(in srgb, var(--success) 22%, transparent);
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
}

.flag-fanart {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent-text);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tv-row:active { transform: none; }
}
</style>
