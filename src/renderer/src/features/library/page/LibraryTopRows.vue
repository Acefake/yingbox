<template>
  <ContinueRow
    v-if="base"
    class="lib-continue"
    :section="base"
    :resume="resumeLibrary"
    @detail="r => emit('open', itemIdOf(r.detail))"
  />
</template>

<script setup lang="ts">
/**
 * 海报墙上方的「继续播放」：只列本分区的条目，没有条目时不渲染；「想看」是「全部」一段里的浏览胶囊。
 * 动漫等按类型分的页面不显示（这些记录只分电影 / 剧集，见 baseSectionOf）；
 * 右键「打开详情」交回条目 id，由页面打开详情。
 * 进入媒体库时按片库观看进度补一次继续播放（别的设备看到的进度、网页端登录后的第一次）。
 */
import { onMounted } from 'vue'

import { ContinueRow } from '@/features/player'

import { hydrateContinue } from '../progress/continue-source'
import { resumeLibrary } from '../progress/resume-library'
import { type LibrarySection, baseSectionOf } from '../state/library-section'

const props = defineProps<{ section: LibrarySection }>()
const emit = defineEmits<{ open: [itemId: number] }>()

const base = baseSectionOf(props.section)

onMounted(() => void hydrateContinue())

/** 媒体库登记的 detail 是 { itemId } */
const itemIdOf = (detail: unknown): number =>
  (detail as { itemId: number }).itemId
</script>

<style scoped>
/* 横排与工具栏、海报墙共用内容边距。 */
:global(.lib-continue) {
  margin: var(--space-4) var(--content-padding-x) var(--space-6);
}
</style>
