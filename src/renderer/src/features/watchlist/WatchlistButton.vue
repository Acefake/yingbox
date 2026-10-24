<template>
  <UiIconButton
    icon="bookmark"
    variant="secondary"
    size="lg"
    :label="active ? '已在想看，点击移除' : '加入想看'"
    :active="active"
    :filled="active"
    :disabled="!meta"
    @click="toggle"
  />
</template>

<script setup lang="ts">
/**
 * 详情页操作区的「想看」按钮：书签图标，已加入时实心并处于按下状态，再点一次移除。
 * meta 为空（详情还没载入）时置灰。
 */
import { computed } from 'vue'

import { toast } from '@/components/ui'
import UiIconButton from '@/components/ui/UiIconButton.vue'

import type { WatchlistMeta } from './watchlist-rules'
import { inWatchlist, toggleWatchlist } from './watchlist-store'

const props = defineProps<{ meta: WatchlistMeta | null }>()

const active = computed(() =>
  props.meta ? inWatchlist(props.meta.section, props.meta.key) : false
)

function toggle(): void {
  if (!props.meta) return
  toast.success(toggleWatchlist(props.meta) ? '已加入想看' : '已从想看移除')
}
</script>
