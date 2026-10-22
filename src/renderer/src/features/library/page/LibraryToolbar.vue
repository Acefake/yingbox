<template>
  <!-- 工具栏：标题与数量、视图切换、搜索筛选排序、操作 -->
  <header class="lib-toolbar">
    <div class="lib-toolbar-title">
      <h1>{{ kindLabel }}</h1>
      <span v-if="count !== null" class="lib-toolbar-count">{{
        count.toLocaleString('zh-CN')
      }}</span>
    </div>
    <UiSegmented
      v-if="hasLibraries"
      v-model="view"
      class="lib-toolbar-views"
      size="sm"
      label="视图"
      :options="viewOptions"
    />
    <div class="lib-toolbar-tools">
      <template v-if="hasLibraries && view === 'wall'">
        <UiSelect
          v-model="filter"
          class="lib-select"
          size="sm"
          aria-label="筛选"
          :options="filterOptions"
        />
        <UiSelect
          v-if="libraryOptions.length > 2"
          v-model="library"
          class="lib-select"
          size="sm"
          aria-label="媒体库"
          :options="libraryOptions"
        />
        <UiSelect
          :model-value="sort"
          class="lib-select"
          size="sm"
          aria-label="排序"
          :options="sortOptions"
          @update:model-value="emit('sort', $event)"
        />
        <UiButton
          :icon="order === 'asc' ? 'arrowUp' : 'arrowDown'"
          size="sm"
          :label="order === 'asc' ? '升序' : '降序'"
          @click="emit('toggle-order')"
        />
      </template>
      <UiButton
        v-if="hasLibraries && view === 'wall' && count"
        icon="grid"
        size="sm"
        label="视频墙"
        @click="emit('video-wall')"
      />
      <UiButton
        v-if="hasLibraries"
        icon="refresh"
        size="sm"
        label="扫描"
        @click="emit('scan')"
      />
      <UiButton
        v-if="hasLibraries"
        icon="sparkle"
        size="sm"
        label="识别全部"
        @click="emit('identify')"
      />
      <UiButton
        icon="settings"
        size="sm"
        label="设置"
        @click="emit('settings')"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 媒体库页面工具栏：标题与数量、资料库 / 演员（番号库）/ 待确认切换、筛选、媒体库、排序与方向、视频墙、扫描 / 识别 / 设置。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 * 搜索用顶栏全局搜索（按 ?q= 在本页过滤），工具栏不再放第二个搜索框。
 */
import UiButton from '@/components/ui/UiButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'

import {
  FILTER_OPTIONS,
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'

/** 页面视图。 */
export type LibraryView = 'wall' | 'actors' | 'review'

defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
  hasLibraries: boolean
  viewOptions: SegmentedOption<LibraryView>[]
  /** 媒体库下拉（含「全部文件夹」）；只有一个媒体库时不显示。 */
  libraryOptions: Array<{ value: number; label: string }>
  sort: WallSort
  order: 'asc' | 'desc'
}>()

const view = defineModel<LibraryView>('view', { required: true })
const filter = defineModel<MatchFilter>('filter', { required: true })
/** 0 表示全部文件夹。 */
const library = defineModel<number>('library', { required: true })

const emit = defineEmits<{
  sort: [value: WallSort]
  'toggle-order': []
  scan: []
  identify: []
  settings: []
  'video-wall': []
}>()

const sortOptions = SORT_OPTIONS.map(o => ({ ...o }))
const filterOptions = FILTER_OPTIONS.map(o => ({ ...o }))
</script>

<style scoped>
.lib-toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
  padding: var(--space-6) var(--content-padding-x) var(--space-4);
}
.lib-toolbar-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
}
.lib-toolbar-title h1 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-tight);
}
.lib-toolbar-count {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-toolbar-tools {
  display: flex;
  flex: 1 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}
/* 下拉按内容宽度，不被拉伸 */
.lib-select {
  flex: 0 0 auto;
  width: auto;
}
</style>
