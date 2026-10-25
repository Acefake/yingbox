<template>
  <div class="cal-card-wrap">
    <UiPressable
      class="cal-card"
      :class="[`is-${entry.status}`, { 'is-compact': compact }]"
      block
      @click="emit('activate', entry)"
    >
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
      <span class="yb-pblur cal-card-blur" aria-hidden="true"
        ><i /><i /><i /><i
      /></span>
      <span class="cal-card-copy">
        <span class="cal-card-code">
          {{ entry.code
          }}<template v-if="entry.episodeTitle && !compact">
            · {{ entry.episodeTitle }}</template
          >
        </span>
        <span class="cal-card-title">{{ entry.title }}</span>
        <span class="cal-card-foot">
          <!-- 未看的新集由右上角「新」标表示，状态字只留给读屏 -->
          <span
            class="cal-card-status"
            :class="{ 'is-sr': entry.status === 'unwatched' }"
            >{{ STATUS_LABEL[entry.status] }}</span
          >
          <span v-if="actionIcon" class="cal-card-action" aria-hidden="true"
            ><UiIcon :name="actionIcon" size="sm"
          /></span>
        </span>
      </span>
      <span
        v-if="entry.status === 'unwatched'"
        class="cal-card-new"
        aria-hidden="true"
        >新</span
      >
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
 * 追剧日历的一张卡（Apple TV 式剧照卡）：剧照铺满（剧照优先，没有用剧的背景图 / 在线封面），
 * 下半同图渐进模糊 + 暗化（.yb-pblur）后压上集号、剧名、状态；未看的新集右上角白色「新」标。周视图（compact）是竖一点的卡，列表视图 16:9。
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
  top: var(--space-2);
  left: var(--space-2);
}

.cal-card {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
  color: var(--media-text);
  text-align: left;
  isolation: isolate;
  transition:
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.cal-card.is-compact {
  aspect-ratio: 8 / 9;
}
.cal-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.cal-card-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 25%;
}
.cal-card.is-upcoming .cal-card-img {
  filter: saturate(0.4);
  opacity: 0.7;
}

.cal-card-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: var(--space-8);
  color: var(--text-quaternary);
}

/* 渐进模糊区：周视图的竖卡模糊得高一点，压暗更重，好让三行字在亮图上也清楚 */
.cal-card-blur {
  --pblur-height: 62%;
  --pblur-tint: var(--scrim-fade-card);
}
.cal-card.is-compact .cal-card-blur {
  --pblur-height: 66%;
}

.cal-card-copy {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-0_5);
  padding: 0 var(--space-3) var(--space-2_5);
}
.cal-card-code {
  overflow: hidden;
  color: var(--media-text-secondary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-card-title {
  overflow: hidden;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 18px;
}
.cal-card-status {
  color: var(--media-text-secondary);
  font-size: var(--text-2xs);
}
.cal-card-status.is-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.cal-card-action {
  display: inline-flex;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.cal-card:hover .cal-card-action,
.cal-card:focus-visible .cal-card-action {
  opacity: 1;
}

.cal-card-new {
  position: absolute;
  top: var(--space-2_5);
  right: var(--space-2_5);
  height: 20px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--media-text);
  color: var(--media-bg);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: 20px;
}
</style>
