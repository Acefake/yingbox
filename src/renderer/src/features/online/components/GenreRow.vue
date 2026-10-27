<template>
  <div ref="root">
    <UiShelf class="genre-row" title="按类型浏览" list>
      <template #actions>
        <span class="genre-hint">点进去可切电影 / 剧集</span>
      </template>
      <UiPressable
        v-for="card in cards"
        :key="card.genre"
        class="genre-card"
        role="listitem"
        @click="emit('open', card.genre)"
      >
        <img
          v-if="srcOf(card.items.value?.[0])"
          class="genre-art"
          :src="srcOf(card.items.value?.[0])"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="onError(card.items.value?.[0])"
        />
        <span class="genre-name">{{ card.genre }}</span>
      </UiPressable>
    </UiShelf>
  </div>
</template>

<script setup lang="ts">
/**
 * 首页「按类型浏览」：一排 6 张 4:3 大卡，左下大字类型名，底部暗渐变。
 * 背景取该类型（电影）豆瓣浏览第一条的 TMDB 剧照，没有就用海报；这一排滚进视口才取，取到前是渐变底。
 * 不写数量（没有数据源）。点卡 emit open，在线页打开该类型的浏览页（默认电影）。
 */
import { reactive, ref } from 'vue'

import UiPressable from '@/components/ui/UiPressable.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import { thumbSrc } from '@/services/thumbnails'

import {
  artOf,
  useDoubanPreview,
  whenVisible,
} from '../composables/use-home-browse'
import type { DoubanItem } from '../types'
import { HOME_GENRES, genreQuery } from '../utils/browse-target'

const emit = defineEmits<{ open: [genre: string] }>()

const cards = HOME_GENRES.map(genre => ({
  genre,
  ...useDoubanPreview(genreQuery(genre, 'movie'), 1),
}))

const root = ref<HTMLElement | null>(null)
whenVisible(root, () => cards.forEach(card => void card.load()))

/** 加载失败过的地址：缩略图失败退回原图，原图也失败就留渐变底 */
const broken = reactive(new Set<string>())
const srcOf = (item: DoubanItem | undefined): string => {
  const art = artOf(item)
  if (!art) return ''
  const thumb = thumbSrc(art, 780)
  if (!broken.has(thumb)) return thumb
  return broken.has(art) ? '' : art
}
const onError = (item: DoubanItem | undefined): void => {
  const src = srcOf(item)
  if (src) broken.add(src)
}
</script>

<style scoped>
.genre-row :deep(.yb-shelf-track) {
  --shelf-cols: 6;
}
@container (max-width: 1100px) {
  .genre-row :deep(.yb-shelf-track) {
    --shelf-cols: 4.4;
  }
}
@container (max-width: 640px) {
  .genre-row :deep(.yb-shelf-track) {
    --shelf-cols: 2.3;
  }
}

.genre-hint {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.genre-card {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: linear-gradient(
    135deg,
    var(--bg-fill-secondary),
    var(--bg-fill-tertiary)
  );
  box-shadow: var(--shadow-card);
  isolation: isolate;
}
/* 底部暗渐变：类型名压在任何画面上都读得清（两种主题下都是深色） */
.genre-card::after {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(transparent 35%, var(--overlay-scrim));
  content: '';
  pointer-events: none;
}
.genre-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-normal) var(--ease-out);
}
.genre-card:hover .genre-art,
.genre-card:focus-visible .genre-art {
  transform: scale(1.04);
}
.genre-name {
  position: absolute;
  left: var(--space-4);
  bottom: var(--space-3);
  z-index: var(--z-raised);
  color: var(--media-text);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.08em;
}

@media (prefers-reduced-motion: reduce) {
  .genre-art {
    transition: none;
  }
}
</style>
