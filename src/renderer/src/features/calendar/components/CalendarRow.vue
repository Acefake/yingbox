<template>
  <div class="cal-row-wrap">
    <UiPressable
      class="cal-row"
      :class="`is-${group.status}`"
      block
      :title="`${group.title} ${group.code}`"
      @click="emit('activate', group.primary)"
    >
      <span class="cal-row-thumb">
        <img
          v-if="imageUrl && !broken"
          :src="imageUrl"
          alt=""
          loading="lazy"
          decoding="async"
          @error="broken = true"
        />
        <UiIcon v-else name="tv" size="sm" />
        <span
          v-if="group.status === 'unwatched'"
          class="cal-row-new"
          aria-hidden="true"
          >新</span
        >
        <span v-if="playable" class="cal-row-play" aria-hidden="true"
          ><UiIcon name="play" size="sm"
        /></span>
      </span>
      <span class="cal-row-copy">
        <span class="cal-row-title">{{ group.title }}</span>
        <span class="cal-row-meta">
          <span class="cal-row-code"
            >{{ group.code
            }}<template v-if="group.episodeTitle && !compact">
              · {{ group.episodeTitle }}</template
            ></span
          >
          <!-- 状态字只留给读屏：未看由剧照角上的小「新」标表示，已看 / 待播由淡化表示 -->
          <span class="cal-row-status">{{ STATUS_LABEL[group.status] }}</span>
        </span>
      </span>
    </UiPressable>
    <AutograbMarkChip
      v-if="mark"
      class="cal-row-mark"
      :mark="mark"
      @open="key => emit('mark', key)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 追剧日历的一行：同一天同一部剧的几集合并成一行（calendar-rules.ts groupShowsByDay），
 * 左边小剧照（剧照优先，没有用剧的背景图 / 在线封面），右边剧名与集号区间（S01E09–E10）；
 * 有未看的集在剧照左下角放一个小「新」标，已看 / 待播的行整体淡一档（状态字只给读屏）。
 * 点行交给页面（本地有文件就播放第一集未看的，否则打开详情）；本地能播时剧照上悬停出播放图标。
 * 追更中的集在行下面挂追更小标记（mark），点它交给页面打开追更面板（与行本身是两个按钮，不嵌套）。
 */
import { computed, ref, watch } from 'vue'

import { UiIcon, UiPressable } from '@/components/ui'
import { type AutograbMark, AutograbMarkChip } from '@/features/autograb'
import { libraryImage } from '@/features/library'
import { thumbSrc } from '@/services/thumbnails'

import {
  type CalendarEntry,
  STATUS_LABEL,
  type ShowDayGroup,
} from '../calendar-rules'

const props = defineProps<{
  group: ShowDayGroup
  /** 周视图的窄列：不写集名 */
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
  () => props.group.image,
  () => (broken.value = false)
)

const imageUrl = computed(() => {
  const { image, imageKind } = props.group
  if (!image) return null
  return imageKind === 'library' ? libraryImage(image) : thumbSrc(image, 300)
})

/** 点开的那一集本地有文件：剧照上悬停出播放图标 */
const playable = computed(() => !!props.group.primary.library?.playable)
</script>

<style scoped>
.cal-row-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  min-width: 0;
}

.cal-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  padding: var(--space-1_5);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out);
}
.cal-row:hover {
  background: var(--bg-glass-hover);
}

.cal-row-thumb {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
}
.cal-row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cal-row.is-upcoming .cal-row-thumb img {
  opacity: 0.55;
}
.cal-row-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--overlay-scrim);
  color: var(--media-text);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.cal-row:hover .cal-row-play,
.cal-row:focus-visible .cal-row-play {
  opacity: 1;
}

.cal-row-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
}
.cal-row-title {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-row.is-upcoming .cal-row-title,
.cal-row.is-watched .cal-row-title {
  color: var(--text-secondary);
}
.cal-row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1_5);
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
}
.cal-row-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-row-new {
  position: absolute;
  bottom: var(--space-0_5);
  left: var(--space-0_5);
  z-index: var(--z-raised);
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  background: var(--media-text);
  color: var(--media-bg);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  line-height: 14px;
}
.cal-row-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
/* 窄列（最小窗口的周视图约 120px 一列）：剧照缩小、内边距收紧，集号区间仍放得下 */
@container (max-width: 150px) {
  .cal-row {
    gap: var(--space-1_5);
    padding: var(--space-1);
  }
  .cal-row-thumb {
    width: 32px;
    height: 32px;
  }
  .cal-row-mark {
    margin-left: 0;
  }
}
/* 追更小标记挂在剧名下方（与文字左对齐：行内边距 + 剧照 + 间距） */
.cal-row-mark {
  margin-left: calc(40px + var(--space-2) + var(--space-1_5));
}
</style>
