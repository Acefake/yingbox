<template>
  <GrabSheet
    :open="episode !== null"
    :title="title"
    subtitle="这一集的追更状态与候选"
    @close="emit('close')"
  >
    <AutograbEpisodes
      v-if="episode"
      :episodes="[episode]"
      :busy="ag.busy"
      @grab="ag.grab"
      @revert="ag.revert"
      @skip="ag.skip"
      @retry="ag.retry"
    />
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 日历卡片上追更小标记点开的侧板：这一集的状态与候选，就地转存 / 跳过 / 重搜 / 撤销。
 * episodeKey 是「剧 id:季:集」；总览里没有这一集（已被挤出最近 60 集）时不打开。
 */
import { computed, watch } from 'vue'

import { episodeCode } from '../autograb-rules'
import { useAutograb } from '../use-autograb'
import AutograbEpisodes from './AutograbEpisodes.vue'
import GrabSheet from './GrabSheet.vue'

const props = defineProps<{ episodeKey: string | null }>()
const emit = defineEmits<{ close: [] }>()

const ag = useAutograb()
const episode = computed(
  () =>
    ag.overview.value?.episodes.find(ep => ep.key === props.episodeKey) ?? null
)
// 这一集不在总览里了（被挤出去或被清掉）：关掉，别等它回来时自己弹出
watch(
  () => [props.episodeKey, ag.overview.value, episode.value] as const,
  ([key, overview, ep]) => {
    if (key && overview && !ep) emit('close')
  }
)
const title = computed(() =>
  episode.value
    ? `${episode.value.seriesTitle} ${episodeCode(episode.value)}`
    : '追更'
)
</script>
