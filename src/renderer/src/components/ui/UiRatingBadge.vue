<template>
  <span
    v-if="badge || other"
    class="ui-rating-badge yb-glass is-media"
    role="img"
    :aria-label="
      badge
        ? `${badge.source === 'douban' ? '豆瓣' : 'TMDB'} ${badge.score}`
        : other
    "
  >
    <svg
      v-if="badge?.source === 'douban'"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <rect width="14" height="14" rx="3" fill="#2e963d" />
      <text
        x="7"
        y="11"
        text-anchor="middle"
        font-size="11"
        font-weight="700"
        fill="#fff"
        font-family="PingFang SC, Microsoft YaHei, sans-serif"
      >
        豆
      </text>
    </svg>
    <svg
      v-else-if="badge"
      width="30"
      height="14"
      viewBox="0 0 30 14"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" x2="1">
          <stop offset="0" stop-color="#90cea1" />
          <stop offset="1" stop-color="#01b4e4" />
        </linearGradient>
      </defs>
      <rect width="30" height="14" rx="3" fill="#032541" />
      <rect
        x="1"
        y="1"
        width="28"
        height="12"
        rx="2.2"
        :fill="`url(#${gradientId})`"
      />
      <text
        x="15"
        y="10.2"
        text-anchor="middle"
        font-size="8"
        font-weight="800"
        fill="#032541"
        font-family="Arial, Helvetica, sans-serif"
        letter-spacing=".2"
      >
        TMDB
      </text>
    </svg>
    <span aria-hidden="true">{{ badge?.score ?? other }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 海报左下角的评分角标：来源小标 + 一位小数。
 * 豆瓣是绿底白「豆」，TMDB 是品牌色小标；材质用画面上的玻璃（.yb-glass.is-media）。
 * 两个来源都有时豆瓣优先。没有可用分数时不渲染。
 */
import { computed, useId } from 'vue'

import { pickRatingBadge } from './rating-badge'

const props = defineProps<{
  /** 豆瓣分数（「8.8」或数字）；「暂无」视为没有 */
  douban?: string | number | null
  /** TMDB 分数；豆瓣没有时才用 */
  tmdb?: string | number | null
  /** 其他或未知来源的评分显示文字 */
  other?: string
}>()

const badge = computed(() => pickRatingBadge(props.douban, props.tmdb))
const gradientId = `yb-tmdb-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
</script>

<style>
.ui-rating-badge {
  position: absolute;
  z-index: var(--z-raised);
  bottom: var(--space-2);
  left: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  height: 22px; /* style-tokens: layout（评分角标） */
  padding: 0 var(--space-2) 0 var(--space-1);
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  pointer-events: none;
}
.ui-rating-badge svg {
  display: block;
  flex: none;
}
</style>
