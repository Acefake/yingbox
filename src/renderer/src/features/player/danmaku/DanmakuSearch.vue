<template>
  <div class="danmaku-search">
    <div class="danmaku-search-row">
      <UiInput
        v-model="query"
        v-enter="() => emit('search')"
        class="danmaku-search-input"
        size="sm"
        placeholder="作品名…"
      />
      <UiButton
        size="sm"
        icon="search"
        label="搜索"
        :loading="searching"
        @click="emit('search')"
      />
    </div>
    <p v-if="message" class="danmaku-search-msg">{{ message }}</p>

    <div v-if="picked" class="danmaku-search-list">
      <UiListRow class="danmaku-search-back" @click="picked = null">
        <span class="danmaku-search-name">‹ {{ picked.animeTitle }}</span>
      </UiListRow>
      <UiListRow
        v-for="episode in picked.episodes"
        :key="episode.episodeId"
        class="danmaku-search-item"
        @click="emit('pick', picked, episode)"
      >
        <span class="danmaku-search-name">{{ episode.episodeTitle }}</span>
      </UiListRow>
    </div>
    <div v-else class="danmaku-search-list">
      <UiListRow
        v-for="anime in results"
        :key="anime.animeId"
        class="danmaku-search-item"
        @click="choose(anime)"
      >
        <span class="danmaku-search-name">{{ anime.animeTitle }}</span>
        <template #description>
          <span class="danmaku-search-meta">
            {{ anime.typeDescription }} · {{ anime.episodes.length }} 集
          </span>
        </template>
      </UiListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 搜索弹幕：按作品名搜 → 选作品 → 选集，选定后由面板绑定到当前条目（只有一集时直接绑定）。
 */
import { ref, watch } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import { vEnter } from '@/directives/enter'

import type { DanmakuAnime } from '../../../../../shared/contract/danmaku'

const props = defineProps<{
  results: DanmakuAnime[]
  searching: boolean
  message: string
}>()
const emit = defineEmits<{
  search: []
  pick: [anime: DanmakuAnime, episode: DanmakuAnime['episodes'][number]]
}>()

/** 搜索关键词（v-model:query） */
const query = defineModel<string>('query', { required: true })
/** 已选的作品（显示它的集列表） */
const picked = ref<DanmakuAnime | null>(null)

watch(
  () => props.results,
  () => {
    picked.value = null
  }
)

const choose = (anime: DanmakuAnime): void => {
  if (anime.episodes.length === 1) emit('pick', anime, anime.episodes[0])
  else picked.value = anime
}
</script>

<style scoped>
.danmaku-search {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.danmaku-search-row {
  display: flex;
  gap: var(--space-2);
  padding: 0 var(--space-3) var(--space-2);
}

.danmaku-search-input {
  flex: 1;
}

.danmaku-search-msg {
  margin: 0 var(--space-3) var(--space-2);
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.danmaku-search-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-2) var(--space-2);
}

.danmaku-search-item,
.danmaku-search-back {
  padding: var(--space-2);
  margin-bottom: var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  color: inherit;
}

.danmaku-search-back {
  background: transparent;
}

.danmaku-search-item:hover {
  background: var(--bg-glass-hover);
}

.danmaku-search-name {
  display: block;
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danmaku-search-meta {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}
</style>
