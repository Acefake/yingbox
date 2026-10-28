<template>
  <div id="home-collections" ref="root">
    <UiShelf class="coll-row" title="精选片单" list>
      <UiPressable
        v-for="card in cards"
        :key="card.id"
        class="coll-card"
        role="listitem"
        @click="emit('open', card.id)"
      >
        <span
          v-if="bgOf(card.items.value)"
          class="coll-bg"
          :style="{
            backgroundImage: `url(&quot;${bgOf(card.items.value)}&quot;)`,
          }"
          aria-hidden="true"
        />
        <span class="coll-text">
          <span class="coll-kicker">{{ card.kicker }}</span>
          <span class="coll-title">{{ card.title }}</span>
          <span class="coll-blurb">{{ card.blurb }}</span>
        </span>
        <span class="coll-fan" aria-hidden="true">
          <img
            v-for="(src, i) in fanOf(card.items.value)"
            :key="i"
            :src="src"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          />
        </span>
      </UiPressable>
    </UiShelf>
  </div>
</template>

<script setup lang="ts">
/**
 * 首页「精选片单」：4 张扁宽卡（豆瓣高分 / 冷门佳片 / 华语热门 / 韩剧热播，映射见 utils/browse-target.ts），
 * 放在首页最底下。左侧英文小标签 + 标题 + 一句描述；右侧该片单前 3 张海报叠在一起（第一张在最上）；
 * 背景是首张海报大幅模糊、压暗后的颜色。文字区宽度给海报让出位置，两者不重叠。
 * 这一排滚进视口才取数据，取到前是渐变底。点卡 emit open，在线页打开该片单的浏览页。
 */
import { ref } from 'vue'

import UiPressable from '@/components/ui/UiPressable.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import { thumbSrc } from '@/services/thumbnails'

import {
  posterOf,
  useDoubanPreview,
  whenVisible,
} from '../composables/use-home-browse'
import type { DoubanItem } from '../types'
import {
  COLLECTIONS,
  type CollectionId,
  collectionQuery,
} from '../utils/browse-target'

const emit = defineEmits<{ open: [id: CollectionId] }>()

const cards = COLLECTIONS.map(c => ({
  ...c,
  ...useDoubanPreview(collectionQuery(c), 3),
}))

const root = ref<HTMLElement | null>(null)
whenVisible(root, () => cards.forEach(card => void card.load()))

/** 背景：首张海报的小缩略图（反正要大幅模糊） */
const bgOf = (items: DoubanItem[] | null): string => {
  const poster = posterOf(items?.[0])
  return poster ? thumbSrc(poster, 300) : ''
}

/** 扇形的三张：DOM 顺序 第二、第三、第一，第一张叠在最上（样式按 nth-child 摆位） */
const fanOf = (items: DoubanItem[] | null): string[] => {
  const posters = (items ?? []).map(posterOf).filter(Boolean)
  const ordered = [posters[1], posters[2], posters[0]].filter(Boolean)
  return ordered.map(p => thumbSrc(p as string, 300))
}
</script>

<style scoped>
.coll-row :deep(.yb-shelf-track) {
  --shelf-cols: 4;
}
@container (max-width: 1100px) {
  .coll-row :deep(.yb-shelf-track) {
    --shelf-cols: 2.4;
  }
}
@container (max-width: 640px) {
  .coll-row :deep(.yb-shelf-track) {
    --shelf-cols: 1.3;
  }
}

.coll-row {
  scroll-margin-top: var(--shell-top);
}
.coll-card {
  --fan-w: 132px; /* style-tokens: layout（片单右侧叠放海报的占位） */
  position: relative;
  display: flex;
  align-items: center;
  height: 116px; /* style-tokens: layout（精选片单卡高） */
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: linear-gradient(
    135deg,
    var(--media-bg),
    var(--bg-fill-secondary)
  );
  box-shadow: var(--shadow-card);
  color: var(--media-text);
  text-align: left;
  isolation: isolate;
}
/* 首张海报放大、模糊、压暗成底色；之上再压一层黑幕，白字在亮海报上也读得清 */
.coll-bg {
  position: absolute;
  inset: calc(var(--space-8) * -1);
  z-index: 0;
  background-position: center;
  background-size: cover;
  filter: blur(36px) saturate(1.5) brightness(0.6);
}
.coll-card::before {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--overlay-scrim-soft);
  content: '';
}
.coll-text {
  position: relative;
  z-index: var(--z-above);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-0_5);
  max-width: calc(100% - var(--fan-w));
  padding: var(--space-3) var(--space-2) var(--space-3) var(--space-4);
}
.coll-kicker {
  white-space: nowrap;
  color: var(--media-text-tertiary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.12em;
}
.coll-title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
}
.coll-blurb {
  color: var(--media-text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}

/* 右侧三张海报叠放，垂直居中；DOM 顺序第二、第三、第一，第一张在最上 */
.coll-fan {
  position: absolute;
  top: 50%;
  right: var(--space-4);
  z-index: var(--z-raised);
  display: flex;
  align-items: center;
  transform: translateY(-50%);
  transition: transform var(--duration-normal) var(--ease-out);
}
.coll-fan img {
  width: 52px; /* style-tokens: layout（片单叠放海报宽） */
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: var(--radius-sm);
  box-shadow:
    var(--shadow-md),
    inset 0 0 0 0.5px var(--glass-media-edge);
}
.coll-fan img + img {
  margin-left: calc(var(--space-3_5) * -1);
}
.coll-fan img:nth-child(3) {
  position: relative;
  z-index: var(--z-raised);
}
.coll-card:hover .coll-fan,
.coll-card:focus-visible .coll-fan {
  transform: translateY(calc(-50% - var(--space-1)));
}

@media (prefers-reduced-motion: reduce) {
  .coll-fan {
    transition: none;
  }
}
</style>
