<template>
  <SeriesGrabSheet
    :series-id="tracking.sheet.value?.seriesId ?? null"
    :title="tracking.sheet.value?.title"
    @close="tracking.closeSheet"
  />
  <TrackCandidateSheet
    :choice="tracking.choice.value"
    :busy="tracking.busy.value !== null"
    @close="tracking.closeChoice"
    @pick="tracking.pick"
  />
</template>

<script setup lang="ts">
/**
 * 在线剧追更（useOnlineTracking）要开的两块侧板：建好后的这部剧的追更侧板，和剧名对不准时的候选面板。
 */
import type { UseOnlineTrackingReturn } from '../use-online-tracking'
import SeriesGrabSheet from './SeriesGrabSheet.vue'
import TrackCandidateSheet from './TrackCandidateSheet.vue'

defineProps<{ tracking: UseOnlineTrackingReturn }>()
</script>
