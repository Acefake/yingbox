<template>
  <component
    :is="$slots.actions ? 'div' : 'button'"
    :type="$slots.actions ? undefined : 'button'"
    class="yb-media-row"
    :class="{ 'is-dense': dense, 'is-selected': selected }"
    v-on="$slots.actions ? {} : { click: () => emit('open') }"
  >
    <UiPressable
      v-if="$slots.actions && openable"
      class="yb-media-row-hit"
      :label="label || title"
      @click="emit('open')"
    />
    <span class="yb-media-row-poster" aria-hidden="true">
      <img
        v-if="image && !broken"
        :class="{ 'is-loaded': loaded }"
        :src="webImageSrc(image)"
        alt=""
        :width="dense ? 32 : 48"
        :height="dense ? 48 : 72"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @load="loaded = true"
        @error="broken = true"
      />
      <UiIcon v-else name="movie" size="sm" />
      <span v-if="progress !== undefined" class="yb-media-row-progress"
        ><i :style="{ '--progress': clamp(progress) }"
      /></span>
    </span>
    <span class="yb-media-row-body">
      <span class="yb-media-row-title"
        >{{ title
        }}<span v-if="dense && year" class="yb-media-row-year">
          · {{ year }}</span
        ></span
      >
      <slot name="status">
        <span v-if="!dense && metaText" class="yb-media-row-meta">{{
          metaText
        }}</span>
      </slot>
      <span
        v-if="specs?.length || rating || noteText"
        class="yb-media-row-specs"
      >
        <UiSpecBadge
          v-for="spec in specs"
          :key="spec.variant + spec.text"
          :variant="spec.variant"
          :text="spec.text"
        />
        <span v-if="rating" class="yb-media-row-rating"
          ><UiIcon name="star" size="sm" filled />{{ rating }}</span
        >
        <span v-if="noteText" class="yb-media-row-note">{{ noteText }}</span>
      </span>
    </span>
    <span v-if="$slots.actions" class="yb-media-row-actions"
      ><slot name="actions"
    /></span>
  </component>
</template>

<script setup lang="ts">
/**
 * 影片结果行（Apple TV 式）：AI 助手的结果卡与统一入口的搜索结果行共用这一个组件，视觉语言一致。
 *
 * 左边竖版海报（懒加载、固定尺寸不跳动，加载前是占位底色，失败换成图标；有进度时底部一条进度条），
 * 右边三行：片名；一行说明（年份 · 类型 · 时长或季集）；规格标签（UiSpecBadge）+ 金星评分 + 弱化的备注
 * （AI 理由、来源、剩余时间）。
 *
 * - dense：搜索结果的紧凑行（小海报，片名后接年份，不显示说明行，说明并进备注）；默认是结果卡（大海报、三行）。
 * - 没有 actions 插槽时整行是一个原生按钮（点了 emit open），调用方可透传 id / role="option" / aria-selected，
 *   由外层用 aria-activedescendant 管键盘选中；
 * - 有 actions 插槽时整行是容器：openable 时铺一层无样式按钮（UiPressable）负责整卡点开，按钮放在它上面。
 * - selected 只管外观（中性 --bg-active）；键盘焦点落在整卡按钮上时同样高亮并加焦点环。
 */
import { computed, ref, watch } from 'vue'

import type { SpecBadge } from './spec-badge'
import { webImageSrc } from '@/services/thumbnails'

import UiIcon from './UiIcon.vue'
import UiPressable from './UiPressable.vue'
import UiSpecBadge from './UiSpecBadge.vue'

const props = defineProps<{
  title: string
  /** 海报地址；没有或加载失败显示占位图标 */
  image?: string | null
  /** 紧凑行片名后的年份 */
  year?: string | number | null
  /** 说明行的几段（用 · 连接，空的跳过） */
  meta?: readonly string[]
  specs?: readonly SpecBadge[]
  /** 评分文字（金星之后），如「8.1」「豆瓣 8.2」 */
  rating?: string
  /** 备注的几段（用 · 连接，空的跳过） */
  note?: readonly string[]
  /** 0–1；不给不显示进度条 */
  progress?: number
  dense?: boolean
  selected?: boolean
  /** 有 actions 时整卡可点开 */
  openable?: boolean
  /** 整卡按钮的无障碍名称；默认片名 */
  label?: string
}>()
const emit = defineEmits<{ open: [] }>()

const broken = ref(false)
const loaded = ref(false)
watch(
  () => props.image,
  () => {
    broken.value = false
    loaded.value = false
  }
)

const join = (parts: readonly string[] | undefined): string =>
  (parts ?? []).filter(Boolean).join(' · ')
const metaText = computed(() => join(props.meta))
/** 紧凑行没有说明行：说明并进备注 */
const noteText = computed(() =>
  join(
    props.dense ? [...(props.meta ?? []), ...(props.note ?? [])] : props.note
  )
)
const clamp = (value: number): number => Math.min(1, Math.max(0, value))
</script>

<style>
.yb-media-row {
  --row-poster-w: 48px;
  --row-poster-h: 72px;
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: calc(var(--row-poster-h) + var(--space-4));
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  text-align: left;
  transition:
    background-color var(--duration-fast) ease,
    opacity var(--duration-fast) ease;
}
.yb-media-row:where(.is-dense) {
  --row-poster-w: 32px;
  --row-poster-h: 48px;
  min-height: calc(var(--row-poster-h) + var(--space-2));
  padding: var(--space-1) var(--space-3);
}
.yb-media-row:where(button) {
  cursor: pointer;
}
.yb-media-row:where(:hover, :has(> .yb-media-row-hit:hover)) {
  background: var(--bg-active-soft);
}
.yb-media-row:where(.is-selected, :has(> .yb-media-row-hit:focus-visible)) {
  background: var(--bg-active);
}
.yb-media-row:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
/* 整卡按钮铺满一行：焦点环画在整行上，按钮与评分等内容在它上面 */
.yb-media-row-hit {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.yb-media-row-hit:where(:active:not(:disabled)) {
  transform: none;
}
.yb-media-row-actions {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

/* 海报：固定尺寸（不跳动），占位底色 + 细描边；图片加载完淡入 */
.yb-media-row-poster {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: var(--row-poster-w);
  height: var(--row-poster-h);
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  color: var(--text-quaternary);
  box-shadow: inset 0 0 0 0.5px var(--border-strong);
  pointer-events: none;
}
.yb-media-row-poster img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
}
.yb-media-row-poster img:where(.is-loaded) {
  opacity: 1;
}
.yb-media-row-progress {
  position: absolute;
  right: var(--space-1);
  bottom: var(--space-1);
  left: var(--space-1);
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--media-text-tertiary);
}
.yb-media-row-progress i {
  display: block;
  height: 100%;
  background: var(--media-text);
  transform: scaleX(var(--progress, 0));
  transform-origin: left;
}

/* 文字三行：片名 / 说明 / 规格 + 评分 + 备注；都单行省略 */
.yb-media-row-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
  pointer-events: none;
}
.yb-media-row-title,
.yb-media-row-meta,
.yb-media-row-note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yb-media-row-title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.yb-media-row:where(.is-dense) .yb-media-row-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}
.yb-media-row-year {
  color: var(--text-secondary);
  font-weight: var(--font-weight-regular);
}
.yb-media-row-meta {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.yb-media-row-specs {
  display: flex;
  align-items: center;
  gap: var(--space-1_5);
  min-width: 0;
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.yb-media-row:where(.is-dense) .yb-media-row-specs {
  margin-top: 0;
}
.yb-media-row-rating {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-0_5);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.yb-media-row-rating .app-icon {
  color: var(--rating);
}
.yb-media-row-note {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .yb-media-row,
  .yb-media-row-poster img {
    transition: none;
  }
}
</style>
