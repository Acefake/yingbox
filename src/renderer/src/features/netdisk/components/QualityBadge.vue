<template>
  <span
    class="quality-badge"
    :class="{ 'is-empty': !badge }"
    :aria-label="badge ? `画质 ${badge.main} ${badge.sub}` : undefined"
    :aria-hidden="badge ? undefined : 'true'"
  >
    <template v-if="badge">
      <b class="quality-badge-main">{{ badge.main }}</b>
      <small v-if="badge.sub" class="quality-badge-sub">{{ badge.sub }}</small>
    </template>
  </span>
</template>

<script setup lang="ts">
/**
 * 结果行左侧的画质角标：上行分辨率（4K / 1080 / 720），下行片源（REMUX / BD / WEB / HDTV），
 * 从标题认出（utils/release-quality）。认不出时留一块空底，各行文字仍对齐、行高不变。
 */
import { computed } from 'vue'

import { parseReleaseQuality, qualityBadge } from '../utils/release-quality'

const props = defineProps<{ title: string }>()

const badge = computed(() => qualityBadge(parseReleaseQuality(props.title)))
</script>

<style scoped>
.quality-badge {
  display: inline-flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: var(--control-height-lg);
  height: var(--control-height-lg);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
  line-height: 1.15;
}
.quality-badge:where(.is-empty) {
  opacity: 0.5;
}
.quality-badge-main {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}
.quality-badge-sub {
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.02em;
}
</style>
