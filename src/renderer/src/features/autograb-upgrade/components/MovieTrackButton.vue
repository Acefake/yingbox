<template>
  <UiIconButton
    v-if="autograbUpgradeAvailable && tmdbId"
    icon="clock"
    variant="secondary"
    size="lg"
    :label="
      tracking ? '已在追踪上线，点击取消' : '追踪上线：发行后自动搜 115 资源'
    "
    :active="tracking"
    :filled="tracking"
    :loading="busy"
    @click="toggle"
  />
</template>

<script setup lang="ts">
/**
 * 电影详情页操作区的「追踪上线」挂点：时钟图标，追踪中时实心并处于按下状态，再点一次取消。
 * 没有 TMDB id（详情还没载入或不是电影）或在网页端时不显示。
 */
import { ref, watch } from 'vue'

import { toast } from '@/components/ui/toast'
import UiIconButton from '@/components/ui/UiIconButton.vue'

import { autograbUpgradeAvailable, moviesApi } from '../api'

const props = defineProps<{ tmdbId: number | null }>()

const tracking = ref(false)
const busy = ref(false)

watch(
  () => props.tmdbId,
  async id => {
    tracking.value = false
    if (!autograbUpgradeAvailable || !id) return
    tracking.value =
      (await moviesApi()
        .status(id)
        .catch(() => null)) !== null
  },
  { immediate: true }
)

async function toggle(): Promise<void> {
  const id = props.tmdbId
  if (!id || busy.value) return
  busy.value = true
  try {
    if (tracking.value) {
      await moviesApi().untrack(id)
      tracking.value = false
      toast.success('已取消追踪')
    } else {
      const result = await moviesApi().track(id)
      if (!result.ok) toast.error(result.error)
      else {
        tracking.value = true
        toast.success('已加入追踪，上线后自动搜资源')
      }
    }
  } finally {
    busy.value = false
  }
}
</script>
