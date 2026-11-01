<template>
  <article class="cal-today" :class="`is-${group.status}`">
    <img
      v-if="imageUrl && !broken"
      class="cal-today-img"
      :src="imageUrl"
      alt=""
      loading="lazy"
      decoding="async"
      @error="broken = true"
    />
    <UiCoverFallback v-else :title="group.title" hide-title />
    <div class="cal-today-shade" aria-hidden="true" />
    <UiPressable
      class="cal-today-hit"
      :label="`${group.title} ${group.code}，${playable ? '播放' : '打开详情'}`"
      @click="emit('activate', group.primary)"
    />
    <span class="cal-today-chip">
      <span class="cal-status" :data-tone="status.tone">{{
        status.label
      }}</span>
    </span>
    <div class="cal-today-cap">
      <div class="cal-today-text">
        <h3 class="cal-today-title">{{ group.title }}</h3>
        <p class="cal-today-meta">
          {{ group.code
          }}<template v-if="group.episodeTitle">
            · {{ group.episodeTitle }}</template
          >
        </p>
      </div>
      <UiButton
        v-if="mark?.kind === 'pending'"
        class="cal-today-act"
        size="sm"
        icon="download"
        label="去确认"
        @click="emit('mark', mark.key)"
      />
      <UiIconButton
        v-else-if="mark"
        class="cal-today-act"
        icon="info"
        variant="overlay"
        size="sm"
        :label="`${status.label}，打开这一集的追更`"
        @click="emit('mark', mark.key)"
      />
      <span v-else-if="playable" class="cal-today-play" aria-hidden="true"
        ><UiIcon name="play"
      /></span>
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 日历「今天」一排的大卡：横版剧照（16:9 偏扁），左上角玻璃胶囊写状态（与周视图同一套圆点），
 * 左下剧名与集号。点卡片同周视图的行（能播就播，否则打开详情）；
 * 资源待确认时右下是「去确认」，其它追更状态是一个小圆钮，都打开这一集的追更侧板（转存在侧板里做）。
 * 卡片点击区是铺满的 UiPressable，操作按钮叠在它上面，两者不嵌套。
 */
import { computed, ref, watch } from 'vue'

import {
  UiButton,
  UiCoverFallback,
  UiIcon,
  UiIconButton,
  UiPressable,
} from '@/components/ui'
import type { AutograbMark } from '@/features/autograb'
import { libraryImage } from '@/features/library'
import { thumbSrc } from '@/services/thumbnails'

import type { CalendarEntry } from '../calendar-rules'
import { type ShowDayGroup, rowStatus } from '../calendar-rows'

const props = defineProps<{
  group: ShowDayGroup
  mark?: AutograbMark | null
}>()
const emit = defineEmits<{
  activate: [entry: CalendarEntry]
  mark: [key: string]
}>()

const broken = ref(false)
watch(
  () => props.group.image,
  () => (broken.value = false)
)

const imageUrl = computed(() => {
  const { image, imageKind } = props.group
  if (!image) return null
  return imageKind === 'library' ? libraryImage(image) : thumbSrc(image, 780)
})
const playable = computed(() => !!props.group.primary.library?.playable)
const status = computed(() => rowStatus(props.group, props.mark ?? null))
</script>

<style scoped src="./row-status.css"></style>
<style scoped>
.cal-today {
  position: relative;
  aspect-ratio: 16 / 8.4;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
  color: var(--media-text);
  isolation: isolate;
}
.cal-today-img,
.cal-today :deep(.ui-cover-fallback) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-slow) var(--ease-out);
}
.cal-today.is-upcoming .cal-today-img {
  filter: saturate(0.6) brightness(0.75);
}
.cal-today:hover .cal-today-img {
  transform: scale(1.03);
}
.cal-today-shade {
  position: absolute;
  inset: 0;
  background: var(--scrim-fade-card);
}
.cal-today-hit {
  position: absolute;
  inset: 0;
  z-index: var(--z-raised);
  border-radius: inherit;
}
/* 卡片裁了圆角（overflow: hidden），焦点环画在内侧 */
.cal-today-hit:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}

.cal-today-chip {
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
  z-index: var(--z-above);
  display: inline-flex;
  align-items: center;
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  background: var(--glass-media-bg);
  box-shadow: var(--glass-media-shadow);
  backdrop-filter: var(--glass-filter);
  pointer-events: none;
}
/* 胶囊压在画面上：文字一律用画面色，圆点保留色调 */
.cal-today-chip .cal-status {
  color: var(--media-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.cal-today-chip .cal-status:where([data-tone='playable'])::before {
  background: var(--media-text);
}

.cal-today-cap {
  position: absolute;
  right: var(--space-5);
  bottom: var(--space-4);
  left: var(--space-5);
  z-index: var(--z-above);
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  pointer-events: none;
}
.cal-today-text {
  flex: 1;
  min-width: 0;
}
.cal-today-title {
  overflow: hidden;
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-today-meta {
  overflow: hidden;
  margin: var(--space-1) 0 0;
  color: var(--media-text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-today-act {
  flex: none;
  pointer-events: auto;
}
.cal-today-play {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  border-radius: var(--radius-full);
  background: var(--glass-media-bg);
  box-shadow: var(--glass-media-shadow);
  backdrop-filter: var(--glass-filter);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.cal-today:hover .cal-today-play,
.cal-today:focus-within .cal-today-play {
  opacity: 1;
}
</style>
