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
        <div class="tv-checkbox" :class="{ 'is-checked': isMultiSelectedItem }">
          <UiIcon v-if="isMultiSelectedItem" name="check" size="sm" />
        </div>
      </div>

      <!-- 展开图标（仅当有子项目时显示） -->
      <div class="tv-expand">
        <UiIcon
          v-if="hasChildren"
          name="forward"
          size="sm"
          class="tv-expand-icon"
          :class="{ 'is-open': isExpanded }"
        />
      </div>

      <!-- 图标：季 / 文件夹 / 视频 -->
      <div class="tv-type-icon" :class="{ 'is-active': isSelected }">
        <UiIcon
          :name="
            item.isSeasonFolder
              ? 'tv'
              : item.type === 'folder'
                ? 'folder'
                : 'movie'
          "
        />
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
import UiIcon from '@/components/ui/UiIcon.vue'
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
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
  padding-right: var(--space-2);
  margin-bottom: 1px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    transform var(--duration-instant) ease-out;
}

.tv-row:hover {
  background: var(--bg-glass-hover);
}

.tv-row:active {
  transform: scale(0.985);
}

.tv-row.is-selected {
  background: var(--bg-active);
}

.tv-row.is-multi-selected {
  background: var(--bg-active-soft);
}

.tv-checkbox-wrap {
  margin-right: var(--space-2);
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

.tv-checkbox.is-checked .app-icon {
  width: 10px;
  height: 10px;
  color: var(--text-on-accent);
  --icon-stroke: 3;
}

.tv-expand {
  width: 16px;
  height: 16px;
  margin-right: var(--space-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tv-expand-icon {
  color: var(--text-tertiary);
  transition: transform var(--duration-normal) var(--ease-out);
}

.tv-expand-icon.is-open {
  transform: rotate(90deg);
}

.tv-type-icon {
  margin-right: var(--space-2);
  color: var(--text-tertiary);
  transition: color var(--duration-fast) var(--ease-out);
}

.tv-row:hover .tv-type-icon,
.tv-type-icon.is-active {
  color: var(--text-primary);
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
  font-weight: var(--font-weight-semibold);
}

.tv-flags {
  display: flex;
  gap: var(--space-1);
  margin-left: var(--space-2);
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
  .tv-row:active {
    transform: none;
  }
}
</style>
