<template>
  <UiIconButton
    v-if="autograbAvailable"
    v-bind="$attrs"
    icon="download"
    variant="secondary"
    size="lg"
    label="追更：新集播出后自动搜 115 资源"
    :loading="busy"
    @click="show"
  />
  <SeriesGrabSheet
    v-if="opened"
    :series-id="open ? taskId : null"
    :title="title"
    @close="open = false"
  />
</template>

<script setup lang="ts">
/**
 * 剧集详情页操作区的「追更」入口（和电影的「追踪上线」对称）：点开这部剧的追更侧板，
 * 预先把还没开播的连载剧也设成追更。网页端没有追更时不显示。
 */
import { onDeactivated, ref } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'

import { autograbApi, autograbAvailable } from '../api'
import { autograbStore } from '../autograb-store'
import { showTrackingError } from '../tracking-error'
import SeriesGrabSheet from './SeriesGrabSheet.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ seriesId: number; title: string }>()

const open = ref(false)
/** 第一次点开后才挂侧板（挂载就会订阅追更总览，详情页不点就不该取） */
const opened = ref(false)
const taskId = ref<number | null>(null)
const busy = ref(false)

onDeactivated(() => (open.value = false))

async function show(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const result = await autograbApi().trackLibrary(props.seriesId)
    if (result.status !== 'ready') return
    taskId.value = result.seriesId
    await autograbStore.reload()
    opened.value = true
    open.value = true
  } catch (error) {
    await showTrackingError(error)
  } finally {
    busy.value = false
  }
}
</script>
