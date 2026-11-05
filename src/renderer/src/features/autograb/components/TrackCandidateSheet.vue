<template>
  <GrabSheet
    :open="!!choice"
    :title="`选哪一部是「${choice?.show.title ?? ''}」`"
    subtitle="剧名没能确定对应 TMDB 上的哪一部，选中后开始追更"
    @close="emit('close')"
  >
    <ul v-if="choice" class="tcs-list">
      <li v-for="item in choice.candidates" :key="item.id">
        <UiListRow :disabled="busy" @click="emit('pick', item)">
          <template #leading>
            <GrabPoster :src="item.poster" :title="item.title" size="sm" />
          </template>
          {{ item.title }}
          <template #description>{{ describe(item) }}</template>
        </UiListRow>
      </li>
    </ul>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 在线剧追更时剧名对不准的候选面板：列出 TMDB 候选（海报、片名、年份），点一个即以它的 id 继续建条目并开始追更。
 */
import UiListRow from '@/components/ui/UiListRow.vue'
import type { TrackCandidate } from '../../../../../shared/contract/autograb'

import type { TrackChoice } from '../use-online-tracking'
import GrabPoster from './GrabPoster.vue'
import GrabSheet from './GrabSheet.vue'

defineProps<{ choice: TrackChoice | null; busy: boolean }>()
const emit = defineEmits<{ close: []; pick: [candidate: TrackCandidate] }>()

function describe(item: TrackCandidate): string {
  const original =
    item.originalTitle && item.originalTitle !== item.title
      ? item.originalTitle
      : ''
  return [item.year ? String(item.year) : '', original]
    .filter(Boolean)
    .join(' · ')
}
</script>

<style scoped>
.tcs-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
