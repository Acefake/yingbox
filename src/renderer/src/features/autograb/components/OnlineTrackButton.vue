<template>
  <template v-if="autograbAvailable">
    <UiIconButton
      v-bind="$attrs"
      :icon="tracked ? 'check' : 'download'"
      :label="
        tracked
          ? '追更中：打开追更设置'
          : '追更：在片库建这部剧，新集播出后自动搜 115 资源'
      "
      :loading="tracking.busy.value !== null"
      @click="start"
    />
    <OnlineTrackSheets :tracking="tracking" />
  </template>
</template>

<script setup lang="ts">
/**
 * 在线剧详情页操作区的「追更」入口（ADR-0049）：与日历在线剧行、追更页搜索框共用 useOnlineTracking，
 * 点开在片库里建（或找到）这部剧并打开追更侧板；已在追的显示对勾，点开设置。网页端没有追更时不显示。
 */
import { computed } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'

import { autograbAvailable } from '../api'
import { useOnlineTracking } from '../use-online-tracking'
import OnlineTrackSheets from './OnlineTrackSheets.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  title: string
  /** CMS 的 vod_year 等，不像年份时忽略 */
  year?: string | number
}>()

const tracking = useOnlineTracking()
const show = computed(() => {
  const year = Number(props.year)
  return {
    recordId: `detail:${props.title}`,
    title: props.title,
    ...(Number.isInteger(year) && year >= 1800 ? { year } : {}),
  }
})
const tracked = computed(() => tracking.isTracked(show.value))

function start(): void {
  void tracking.track(show.value)
}
</script>
