<template>
  <div>
    <div v-if="loading" class="av-search-progress" role="status">
      <p>
        正在聚合 {{ sourceCount }} 个站点…（{{ doneCount }}/{{ sourceCount }}）
      </p>
      <div class="av-progress-track">
        <div
          class="av-progress-bar"
          :style="{ width: `${(doneCount / cmsSourceCount) * 100}%` }"
        />
      </div>
    </div>
    <AvSkeletonGrid v-if="loading && groups.length === 0" />
    <StatusState v-if="error" :title="error" tone="danger">
      <UiButton
        v-if="canRetry"
        icon="refresh"
        label="重试搜索"
        @click="emit('retry')"
      />
    </StatusState>
    <UiVirtualGrid
      v-if="groups.length > 0"
      :items="groups"
      class="ui-poster-grid is-landscape"
      :item-key="group => group.key"
    >
      <template #default="{ item: group }">
        <UiPosterCard
          shape="landscape"
          :title="group.vod_name"
          :cover="coverSrc(group.items[0])"
          :subtitle="`${group.items.length} 个可用来源`"
          :favorite="isFavorite(group.items[0])"
          @open="emit('play', group.items[0])"
          @toggle-favorite="emit('toggle-favorite', group.items[0])"
        >
          <template v-if="group.items[0].vod_remarks" #badges>
            <span class="ui-poster-badge">{{
              group.items[0].vod_remarks
            }}</span>
          </template>
        </UiPosterCard>
      </template>
    </UiVirtualGrid>
    <StatusState
      v-if="!loading && !error && groups.length === 0 && hasSearched"
      icon="search"
      title="未找到相关结果"
    />
    <StatusState
      v-if="!loading && !hasSearched"
      icon="search"
      title="搜索全部启用数据源"
      hint="输入番号或关键词后按回车"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AV 聚合搜索结果：进度条、按片名合并后的卡片网格，以及空 / 出错状态。
 * 搜索本身在 useAvSearch 里，这里只负责展示。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import StatusState from '@/components/StatusState.vue'
import AvSkeletonGrid from './AvSkeletonGrid.vue'
import { coverSrc } from '../utils/av-media'
import type { MergedGroup } from '../utils/av-playback'

defineProps<{
  loading: boolean
  hasSearched: boolean
  error: string
  groups: MergedGroup[]
  doneCount: number
  /** 聚合的站点总数（CMS + 插件） */
  sourceCount: number
  /** 进度条分母沿用原实现：只算 CMS 源 */
  cmsSourceCount: number
  canRetry: boolean
  isFavorite: (video: any) => boolean
}>()
const emit = defineEmits<{
  (e: 'play' | 'toggle-favorite', video: any): void
  (e: 'retry'): void
}>()
</script>

<style scoped>
.av-search-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.av-search-progress p {
  margin: 0;
}
.av-progress-track {
  width: 256px;
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.av-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--text-secondary);
  transition: width var(--duration-normal) var(--ease-out);
}
</style>
