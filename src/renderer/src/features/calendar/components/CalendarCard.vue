<template>
  <div class="cal-card-wrap">
    <UiPressable
      class="cal-card"
      :class="[`is-${entry.status}`, { 'is-compact': compact }]"
      block
      @click="emit('activate', entry)"
    >
      <span class="cal-card-media">
        <img
          v-if="imageUrl && !broken"
          class="cal-card-img"
          :src="imageUrl"
          alt=""
          loading="lazy"
          decoding="async"
          @error="broken = true"
        />
        <span v-else class="cal-card-placeholder" aria-hidden="true">
          <UiIcon name="tv" size="lg" />
        </span>
        <span class="cal-card-shade" aria-hidden="true" />
        <span class="cal-card-status">{{ STATUS_LABEL[entry.status] }}</span>
        <span v-if="actionIcon" class="cal-card-action" aria-hidden="true">
          <UiIcon :name="actionIcon" size="sm" />
        </span>
      </span>
      <span class="cal-card-text">
        <span class="cal-card-title">{{ entry.title }}</span>
        <span class="cal-card-meta">
          <span class="cal-card-code">{{ entry.code }}</span>
          <span v-if="entry.episodeTitle" class="cal-card-ep">{{
            entry.episodeTitle
          }}</span>
        </span>
      </span>
    </UiPressable>
    <AutograbMarkChip
      v-if="mark"
      class="cal-card-mark"
      :mark="mark"
      @open="key => emit('mark', key)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 追剧日历的一张卡：16:9 背景图（剧照优先，没有用剧的背景图 / 在线封面）、剧名、集号、状态。
 * 点卡片交给页面（有本地文件就播放，否则打开详情）；图片地址按来源换成缩略图。
 * 追更中的集左上角有追更小标记（mark），点它交给页面打开追更面板（与卡片本身是两个按钮，不嵌套）。
 */
import { computed, ref, watch } from 'vue'

import { UiIcon, UiPressable } from '@/components/ui'
import type { IconName } from '@/components/ui/icons'
import { type AutograbMark, AutograbMarkChip } from '@/features/autograb'
import { libraryImage } from '@/features/library'
import { thumbSrc } from '@/services/thumbnails'

import { type CalendarEntry, STATUS_LABEL } from '../calendar-rules'

const props = defineProps<{
  entry: CalendarEntry
  /** 周视图的窄列：文字更紧凑 */
  compact?: boolean
  /** 追更状态小标记 */
  mark?: AutograbMark | null
}>()
const emit = defineEmits<{
  activate: [entry: CalendarEntry]
  mark: [key: string]
}>()

const broken = ref(false)
watch(
  () => props.entry.image,
  () => (broken.value = false)
)

const imageUrl = computed(() => {
  const { image, imageKind } = props.entry
  if (!image) return null
  return imageKind === 'library' ? libraryImage(image) : thumbSrc(image, 480)
})

/** 右上角提示点卡片会做什么：本地有文件就是播放 */
const actionIcon = computed<IconName | null>(() =>
  props.entry.library?.playable ? 'play' : null
)
</script>

<style scoped>
.cal-card-wrap {
  position: relative;
  min-width: 0;
}

.cal-card-mark {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
}

.cal-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  text-align: left;
  color: var(--text-primary);
}

.cal-card-media {
  position: relative;
  display: block;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  transition: transform var(--duration-fast) var(--ease-out);
}
.cal-card:hover .cal-card-media {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.cal-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cal-card.is-upcoming .cal-card-img {
  filter: saturate(0.4);
  opacity: 0.7;
}

.cal-card-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-quaternary);
}

/* 底部渐变，让状态角标在亮图上也看得清 */
.cal-card-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--overlay-scrim-soft),
    transparent 55%
  );
}

.cal-card-status {
  position: absolute;
  bottom: var(--space-1);
  left: var(--space-1);
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  background: var(--overlay-scrim);
  color: var(--media-text-secondary);
  font-size: var(--text-2xs);
  line-height: 18px;
}
.cal-card.is-unwatched .cal-card-status {
  background: var(--accent);
  color: var(--text-on-accent);
}

.cal-card-action {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  display: inline-flex;
  padding: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--overlay-scrim);
  color: var(--media-text);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.cal-card:hover .cal-card-action,
.cal-card:focus-visible .cal-card-action {
  opacity: 1;
}

.cal-card-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
}
.cal-card-title {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-card-meta {
  display: flex;
  gap: var(--space-1);
  min-width: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.cal-card-code {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.cal-card-ep {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-card.is-compact .cal-card-ep {
  display: none;
}
</style>
