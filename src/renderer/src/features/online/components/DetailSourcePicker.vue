<template>
  <!-- 播放源加载状态 -->
  <div v-if="searching" class="dw-loading-sources">
    <span class="btn-spinner" />
    <span>正在搜索播放源...</span>
  </div>

  <!-- 播放源 -->
  <div v-if="hasGroups" class="dw-sources-section">
    <h4 class="dw-section-title">播放源</h4>
    <!-- 来源分类 Tabs -->
    <UiSegmented
      v-if="sourceTypeOptions.length > 1"
      class="source-type-tabs"
      label="播放源类型"
      :model-value="currentSourceType"
      :options="sourceTypeOptions"
      @update:model-value="emit('switch-type', $event)"
    />
    <!-- 层级一：源 -->
    <div class="px-2 py-1 mb-1 yb-label">源</div>
    <div class="group-tabs">
      <UiButton
        v-for="(sg, si) in siteGroups"
        :key="si"
        size="sm"
        class="dw-chip"
        :class="{ 'is-selected': activeSite === si }"
        :aria-pressed="activeSite === si"
        :label="sg.siteName"
        @click="emit('switch-site', si)"
      />
    </div>
    <!-- 层级二：线路（多条时才显示） -->
    <template v-if="siteGroups[activeSite]?.lines.length > 1">
      <div class="px-2 py-1 mb-1 mt-2 yb-label">线路</div>
      <div class="group-tabs">
        <UiButton
          v-for="(line, li) in siteGroups[activeSite].lines"
          :key="li"
          size="sm"
          class="dw-chip"
          :class="{ 'is-selected': activeLine === li }"
          :aria-pressed="activeLine === li"
          :label="line.label"
          @click="emit('switch-line', li)"
        />
      </div>
    </template>
    <!-- 层级三：播放列表 -->
    <div class="px-2 py-1 mb-1 mt-2 yb-label">播放列表</div>
    <div class="episode-list">
      <UiButton
        v-for="ep in currentEpisodes"
        :key="ep.url"
        class="dw-chip ep-btn"
        :class="{ 'is-selected': currentUrl === ep.url }"
        :aria-pressed="currentUrl === ep.url"
        :label="ep.name"
        :title="ep.name"
        @click="emit('play', ep.url, ep.ext)"
      />
      <div v-if="!currentEpisodes.length" class="ep-empty">无可用剧集</div>
    </div>
  </div>
  <div v-else-if="!searching && showEmpty" class="dw-sources-section">
    <div class="ep-empty">未找到可用播放源</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 在线详情页的播放源选择：来源类型（插件 / CMS）→ 站点 → 线路 → 剧集。
 * 多根节点组件，直接排在详情信息列里；状态在 useDetailSources，这里只展示和发事件。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import type { SiteGroup, SourceType } from '../utils/detail-sources'

defineProps<{
  searching: boolean
  hasGroups: boolean
  /** 没有任何线路时是否显示「未找到可用播放源」（只在播放层打开时） */
  showEmpty: boolean
  sourceTypeOptions: { value: SourceType; label: string }[]
  currentSourceType: SourceType
  siteGroups: SiteGroup[]
  activeSite: number
  activeLine: number
  currentEpisodes: { name: string; url: string; ext?: Record<string, any> }[]
  currentUrl: string
}>()
const emit = defineEmits<{
  (e: 'switch-type', type: SourceType): void
  (e: 'switch-site' | 'switch-line', index: number): void
  (e: 'play', url: string, ext?: Record<string, any>): void
}>()
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.dw-loading-sources {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.dw-sources-section {
  margin-top: var(--space-6);
}

.ep-empty {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  border-top-color: var(--text-primary);
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.dw-section-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.source-type-tabs {
  margin-bottom: var(--space-4);
}

.group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

/* 源 / 线路 / 剧集选择：UiButton secondary，选中态为中性 --bg-active */
.ui-button.dw-chip.is-selected {
  background: var(--bg-active);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.episode-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: var(--space-2);
  max-height: 168px;
  overflow-y: auto;
  padding-bottom: var(--space-3);
}

.episode-list::-webkit-scrollbar {
  width: 3px;
}

.episode-list::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb-hover);
}

.ui-button.ep-btn {
  min-width: 0;
  padding: 0 var(--space-2);
}

.ep-btn :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
