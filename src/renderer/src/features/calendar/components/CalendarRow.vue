<template>
  <div class="cal-row-wrap" :class="`is-${group.status}`">
    <UiPressable
      class="cal-row"
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
        <span v-if="playable" class="cal-row-play" aria-hidden="true"
          ><UiIcon name="play" size="sm"
        /></span>
      </span>
      <span class="cal-row-copy">
        <span class="cal-row-title">{{ group.title }}</span>
        <span class="cal-row-code"
          >{{ group.code
          }}<template v-if="group.episodeTitle && !compact">
            · {{ group.episodeTitle }}</template
          ></span
        >
        <!-- 有追更标记时状态在行外的按钮上，这里只给读屏补观看状态 -->
        <span v-if="mark" class="cal-row-sr">{{ watchLabel }}</span>
      </span>
    </UiPressable>
    <UiPressable
      v-if="mark"
      v-tooltip="mark.title"
      class="cal-status cal-row-status is-action"
      :data-tone="status.tone"
      :aria-label="`${status.label}，打开这一集的追更`"
      @click="emit('mark', mark.key)"
      >{{ status.label }}</UiPressable
    >
    <span v-else class="cal-status cal-row-status" :data-tone="status.tone">{{
      status.label
    }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 追剧日历的一行：同一天同一部剧的几集合并成一行（calendar-rows.ts groupShowsByDay），
 * 左边 16:9 小剧照（剧照优先，没有用剧的背景图 / 在线封面），右边剧名与集号区间（S01E09–E10）；
 * 下面一行是状态圆点（rowStatus：追更中的集说追更，其余说已看 / 可播放 / 未看 / 待播），已看与待播的行淡一档。
 * 点行交给页面（本地有文件就播放第一集未看的，否则打开详情）；本地能播时剧照上悬停出播放图标。
 * 追更中的集，状态本身是另一个按钮（与行并列，不嵌套），点它交给页面打开这一集的追更侧板。
 */
import { computed, ref, watch } from 'vue'

import { UiIcon, UiPressable, vTooltip } from '@/components/ui'
import type { AutograbMark } from '@/features/autograb'
import { libraryImage } from '@/features/library'
import { thumbSrc } from '@/services/thumbnails'

import type { CalendarEntry } from '../calendar-rules'
import { type ShowDayGroup, rowStatus } from '../calendar-rows'

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
  return imageKind === 'library'
    ? libraryImage(image, 300)
    : thumbSrc(image, 300)
})

/** 点开的那一集本地有文件：剧照上悬停出播放图标 */
const playable = computed(() => !!props.group.primary.library?.playable)
const status = computed(() => rowStatus(props.group, props.mark ?? null))
/** 有追更标记时给读屏补的观看状态（与没有标记时行上写的一致） */
const watchLabel = computed(() => rowStatus(props.group, null).label)
</script>

<style scoped src="./row-status.css"></style>
<style scoped>
.cal-row-wrap {
  --cal-thumb-w: 52px;
  --cal-thumb-h: 30px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cal-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  padding: var(--space-1_5) var(--space-1_5) var(--space-0_5);
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
  width: var(--cal-thumb-w);
  height: var(--cal-thumb-h);
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
.is-upcoming .cal-row-thumb img {
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
.cal-row-title,
.cal-row-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal-row-title {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
}
.cal-row-code {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
}
.is-watched .cal-row-title,
.is-upcoming .cal-row-title {
  color: var(--text-secondary);
}
.is-watched .cal-row-thumb {
  opacity: 0.5;
}

/* 状态行与剧名左对齐：行内边距 + 剧照 + 间距 */
.cal-row-status {
  align-self: flex-start;
  margin: 0 0 var(--space-1)
    calc(var(--space-1_5) + var(--cal-thumb-w) + var(--space-2));
}
.cal-row-status.is-action {
  margin-top: calc(var(--space-0_5) * -1);
  padding: var(--space-0_5) var(--space-1_5);
  margin-left: calc(
    var(--space-1_5) + var(--cal-thumb-w) + var(--space-2) - var(--space-1_5)
  );
  border-radius: var(--radius-full);
  transition: background var(--duration-fast) var(--ease-out);
}
.cal-row-status.is-action:hover {
  background: var(--bg-glass-hover);
}

.cal-row-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 窄列（最小窗口的周视图约 120px 一列，容器是页面的 .cal-day）：剧照缩小 */
@container (max-width: 150px) {
  .cal-row,
  .cal-row-status {
    --cal-thumb-w: 36px;
    --cal-thumb-h: 24px;
  }
}
</style>
