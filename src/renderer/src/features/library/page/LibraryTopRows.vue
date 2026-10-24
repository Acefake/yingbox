<template>
  <ContinueRow
    class="lib-continue"
    :section="section"
    @detail="r => emit('open', itemIdOf(r.detail))"
  />
  <WatchlistRow
    class="lib-continue"
    :section="section"
    @open="e => emit('open', itemIdOf(e.detail))"
  />
</template>

<script setup lang="ts">
/**
 * 海报墙上方的两排：「继续播放」与其下的「想看」。两排都只列本分区的条目，没有条目时各自不渲染；
 * 点卡片（想看）或右键「打开详情」（继续播放）都交回条目 id，由页面打开详情。
 */
import { ContinueRow } from '@/features/player'
import { WatchlistRow } from '@/features/watchlist'

import type { LibrarySection } from '../state/library-section'

defineProps<{ section: LibrarySection }>()
const emit = defineEmits<{ open: [itemId: number] }>()

/** 媒体库登记的 detail 是 { itemId } */
const itemIdOf = (detail: unknown): number =>
  (detail as { itemId: number }).itemId
</script>

<style scoped>
/* 横排与工具栏、海报墙共用内容边距。 */
.lib-continue {
  margin: var(--space-4) var(--content-padding-x) var(--space-6);
}
</style>
