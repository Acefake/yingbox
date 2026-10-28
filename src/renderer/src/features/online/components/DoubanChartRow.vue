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
        <UiCoverFallback v-else :title="item.title" />
        <UiRatingBadge :douban="item.rate" :tmdb="item.tmdbRate" />
      </span>
    </UiPressable>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的豆瓣榜单行（Top 10）：描边名次数字收在海报左侧，一屏大约 6.5 张；海报左下角是评分角标。
 * 数据见 use-home-chart.ts（口碑榜取不到时退回热门电影前 10，标题跟着变）；两路都没有时整行不渲染。
 * 点海报 emit open（在线页打开豆瓣详情 / 选源）。
 */
import { onMounted, reactive } from 'vue'

import UiCoverFallback from '@/components/ui/UiCoverFallback.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import { webImageSrc } from '@/services/thumbnails'

import { useHomeChart } from '../composables/use-home-chart'
import type { DoubanItem } from '../types'

const emit = defineEmits<{ open: [item: DoubanItem] }>()

const chart = useHomeChart()
const { title, items } = chart
onMounted(() => chart.start())

/** 加载失败的封面 */
const broken = reactive(new Set<string>())

/** 封面：TMDB 补全后的海报，补全前用豆瓣封面（网页端豆瓣图走缩略图代理） */
const coverOf = (item: DoubanItem): string =>
  webImageSrc(item.cover || item.coverSrc)
</script>

<style scoped>
/* 一张卡 = 名次数字 + 海报：一屏大约 6.5 张，名次收在左侧 */
.chart-row :deep(.yb-shelf-track) {
  --shelf-cols: 6.5;
}
@container (max-width: 1100px) {
  .chart-row :deep(.yb-shelf-track) {
    --shelf-cols: 5.2;
  }
}
@container (max-width: 820px) {
  .chart-row :deep(.yb-shelf-track) {
    --shelf-cols: 3.6;
  }
}
@container (max-width: 560px) {
  .chart-row :deep(.yb-shelf-track) {
    --shelf-cols: 2.3;
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
  font-size: 58cqw; /* 随卡宽缩放：数字大约是海报高度的一半 */
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
  width: 78%;
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

@media (prefers-reduced-motion: reduce) {
  .chart-poster {
    transition: none;
  }
}
</style>
