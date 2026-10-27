<template>
  <UiShelf
    v-if="items.length"
    class="chart-row"
    :title="title"
    kind="portrait"
    list
  >
    <UiPressable
      v-for="(item, index) in items"
      :key="item.url"
      class="chart-card"
      role="listitem"
      :label="`第 ${index + 1} 名：${item.title}`"
      @click="emit('open', item)"
    >
      <span class="chart-rank" aria-hidden="true">{{ index + 1 }}</span>
      <span class="chart-poster">
        <img
          v-if="coverOf(item) && !broken.has(coverOf(item))"
          :src="coverOf(item)"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="broken.add(coverOf(item))"
        />
        <UiIcon v-else name="movie" size="lg" />
        <span v-if="ratingOf(item)" class="chart-rate"
          ><UiIcon name="star" size="sm" filled />{{ ratingOf(item) }}</span
        >
      </span>
    </UiPressable>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的豆瓣榜单行（Netflix 式 Top 10）：大号描边名次数字，右侧压一张竖版海报，海报左下角是豆瓣评分。
 * 数据见 use-home-chart.ts（口碑榜取不到时退回热门电影前 10，标题跟着变）；两路都没有时整行不渲染。
 * 点海报 emit open（在线页打开豆瓣详情 / 选源）。
 */
import { onMounted, reactive } from 'vue'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import { useHomeChart } from '../composables/use-home-chart'
import type { DoubanItem } from '../types'

const emit = defineEmits<{ open: [item: DoubanItem] }>()

const chart = useHomeChart()
const { title, items } = chart
onMounted(() => chart.start())

/** 加载失败的封面 */
const broken = reactive(new Set<string>())

/** 封面：TMDB 补全后的海报，补全前用豆瓣封面 */
const coverOf = (item: DoubanItem): string => item.cover || item.coverSrc

const ratingOf = (item: DoubanItem): string =>
  /^\d/.test(item.rate) ? item.rate : ''
</script>

<style scoped>
/* 一张卡 = 名次数字 + 海报，比普通海报宽：一排约 5 张 */
.chart-row :deep(.yb-shelf-track) {
  --shelf-cols: 5.2;
}
@container (max-width: 820px) {
  .chart-row :deep(.yb-shelf-track) {
    --shelf-cols: 3.4;
  }
}
@container (max-width: 560px) {
  .chart-row :deep(.yb-shelf-track) {
    --shelf-cols: 2.2;
  }
}

.chart-card {
  position: relative;
  display: block;
  container-type: inline-size;
  border-radius: var(--radius-card);
  text-align: left;
}

/* 名次：描边空心大字，底边与海报底边对齐，被海报压住右侧一截 */
.chart-rank {
  position: absolute;
  bottom: -0.12em;
  left: 0;
  z-index: 0;
  color: transparent;
  font-family: var(--font-display);
  font-size: 72cqw; /* 随卡宽缩放：数字高约为海报高的 3/4 */
  font-weight: var(--font-weight-bold); /* style-tokens: visual（名次） */
  line-height: 1;
  letter-spacing: -0.08em;
  -webkit-text-stroke: 2px var(--text-tertiary);
  pointer-events: none;
}

.chart-poster {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 64%;
  margin-left: auto;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
  color: var(--text-quaternary);
  box-shadow: var(--shadow-md);
  transition:
    transform var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}
.chart-poster::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px var(--glass-media-edge);
  content: '';
  pointer-events: none;
}
.chart-poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chart-card:hover .chart-poster,
.chart-card:focus-visible .chart-poster {
  transform: scale(1.03);
  box-shadow: var(--shadow-lg);
}

.chart-rate {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-0_5) var(--space-1_5);
  border-radius: var(--radius-full);
  background: var(--glass-light-bg);
  color: var(--media-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}

@media (prefers-reduced-motion: reduce) {
  .chart-poster {
    transition: none;
  }
}
</style>
