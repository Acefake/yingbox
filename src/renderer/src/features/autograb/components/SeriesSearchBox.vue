<template>
  <form class="ssb" role="search" @submit.prevent="search">
    <UiInput
      v-model="query"
      v-enter="search"
      class="ssb-input"
      variant="filled"
      icon="search"
      clearable
      placeholder="搜索剧名，加入网盘追剧"
      aria-label="按剧名搜索并追更"
    />
    <UiButton
      type="submit"
      label="追更"
      :loading="tracking.busy.value !== null"
      :disabled="!query.trim()"
    />
    <OnlineTrackSheets :tracking="tracking" />
  </form>
</template>

<script setup lang="ts">
/**
 * 自动追更页的「搜索剧名并追更」：直接建立网盘追剧任务（ADR-0052）。
 * 与日历里在线剧行共用 autograb.trackOnline：匹配剧集后创建任务并打开追更侧板，
 * 对不准时弹候选让用户选，TMDB 找不到时提示。
 */
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { vEnter } from '@/directives/enter'

import { useOnlineTracking } from '../use-online-tracking'
import OnlineTrackSheets from './OnlineTrackSheets.vue'

const query = ref('')
const tracking = useOnlineTracking()

async function search(): Promise<void> {
  const title = query.value.trim()
  if (!title) return
  await tracking.track({ recordId: `search:${title}`, title })
}
</script>

<style scoped>
.ssb {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.ssb-input {
  flex: 1;
  min-width: 0;
}
</style>
