<template>
  <article class="tonight-card">
    <div class="tonight-card-image">
      <img v-if="image" :src="image" alt="" loading="lazy" decoding="async" />
    </div>
    <div class="tonight-card-body">
      <h3 class="tonight-card-title">{{ pick.candidate.title }}</h3>
      <p v-if="meta" class="tonight-card-meta">{{ meta }}</p>
      <p class="tonight-card-reason">{{ pick.reason }}</p>
      <div class="tonight-card-actions">
        <UiButton
          variant="primary"
          size="sm"
          icon="play"
          :label="playLabel"
          :loading="playing"
          @click="emit('play', pick)"
        />
        <UiButton
          size="sm"
          icon="info"
          label="详情"
          @click="emit('detail', pick)"
        />
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 「今晚看什么」的一张推荐卡：横版背景图、片名、时长 / 评分、一句理由、播放与详情。
 */
import { computed } from 'vue'

import { UiButton } from '@/components/ui'

import { itemImage } from '../api/images'
import type { TonightPick } from './tonight-picks'
import { candidateMeta } from './tonight-rules'

const props = defineProps<{ pick: TonightPick; playing?: boolean }>()
const emit = defineEmits<{ play: [TonightPick]; detail: [TonightPick] }>()

const image = computed(
  () =>
    itemImage(props.pick.candidate.backdrop, 780) ??
    itemImage(props.pick.candidate.poster, 780)
)
const meta = computed(() => candidateMeta(props.pick.candidate))
const playLabel = computed(() =>
  props.pick.candidate.continueId ? '继续播放' : '播放'
)
</script>

<style>
.tonight-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-fill-tertiary);
}
.tonight-card-image {
  aspect-ratio: 16 / 9;
  background: var(--bg-fill-secondary);
}
.tonight-card-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tonight-card-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
}
.tonight-card-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.tonight-card-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.tonight-card-reason {
  flex: 1 1 auto;
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-secondary);
}
.tonight-card-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
