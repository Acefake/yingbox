<template>
  <article
    class="ui-poster"
    :class="`is-${shape}`"
    tabindex="0"
    role="button"
    :aria-label="title"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <div class="ui-poster-media">
      <img
        v-if="cover && !broken"
        :src="cover"
        :alt="title"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="broken = true"
      />
      <div v-else class="ui-poster-placeholder">
        <UiIcon name="movie" size="lg" />
      </div>

      <span v-if="rating" class="ui-poster-rating">
        <UiIcon name="star" size="sm" filled />{{ rating }}
      </span>
      <div v-if="$slots.badges" class="ui-poster-badges"><slot name="badges" /></div>

      <div v-if="favorite !== undefined || $slots.actions" class="ui-poster-actions">
        <slot name="actions" />
        <UiIconButton
          v-if="favorite !== undefined"
          icon="heart"
          variant="overlay"
          size="sm"
          :filled="favorite"
          :active="favorite"
          :label="favorite ? '取消收藏' : '收藏'"
          class="ui-poster-favorite"
          :class="{ 'is-on': favorite }"
          @click.stop="emit('toggle-favorite')"
        />
      </div>
      <slot name="overlay" />
    </div>

    <div class="ui-poster-text">
      <h3 class="ui-poster-title" :title="title">{{ title }}</h3>
      <p v-if="subtitle" class="ui-poster-subtitle">{{ subtitle }}</p>
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 海报卡：全应用唯一的海报样式（首页、搜索、片源、收藏、AV、Amane）。
 *
 * 只放三样东西：图、标题、一行副标题。评分在图上左下角，
 * 收藏和其他操作悬停时出现在右上角。更多信息放到详情页。
 */
import { ref } from 'vue'

import UiIcon from './UiIcon.vue'
import UiIconButton from './UiIconButton.vue'

withDefaults(
  defineProps<{
    title: string
    cover?: string
    /** 一行副标题，如「2024 · 电影」 */
    subtitle?: string
    rating?: string | number
    /** undefined 表示不显示收藏按钮 */
    favorite?: boolean
    /** portrait 2:3 海报；landscape 16:9 剧照/封面 */
    shape?: 'portrait' | 'landscape'
  }>(),
  { favorite: undefined, shape: 'portrait' }
)

const emit = defineEmits<{ open: []; 'toggle-favorite': [] }>()

const broken = ref(false)
</script>

<style>
.ui-poster-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(var(--poster-min-width), 1fr)
  );
  gap: var(--poster-gap-y) var(--poster-gap-x);
}
.ui-poster-grid.is-landscape {
  --poster-min-width: 260px;
}
.ui-poster {
  min-width: 0;
  outline: none;
  cursor: pointer;
}
.ui-poster-media {
  position: relative;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-fill-secondary);
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}
.ui-poster.is-landscape .ui-poster-media {
  aspect-ratio: 16 / 9;
}
.ui-poster-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ui-poster-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: var(--text-quaternary);
}
.ui-poster:hover .ui-poster-media {
  transform: translateY(-4px) scale(1.02);
  box-shadow: var(--shadow-md);
}
.ui-poster:focus-visible .ui-poster-media {
  box-shadow:
    0 0 0 3px var(--bg-content),
    0 0 0 6px var(--accent);
}
.ui-poster-rating {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: rgba(0, 0, 0, 0.56);
  color: #fff;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ui-poster-rating .app-icon {
  width: 11px;
  height: 11px;
  color: var(--rating);
}
.ui-poster-badges {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  display: flex;
  gap: var(--space-1);
}
.ui-poster-badge {
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: rgba(0, 0, 0, 0.56);
  color: #fff;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ui-poster-actions {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.ui-poster:hover .ui-poster-actions,
.ui-poster:focus-within .ui-poster-actions,
.ui-poster-actions:has(.is-on) {
  opacity: 1;
}
.yb-icon-button.ui-poster-favorite.is-on,
.yb-icon-button.ui-poster-favorite.is-on:hover {
  color: var(--favorite);
}
.ui-poster-text {
  padding-top: var(--space-3);
}
.ui-poster-title {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-poster-subtitle {
  margin: var(--space-1) 0 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (hover: none) {
  .ui-poster-actions {
    opacity: 1;
  }
}
</style>
