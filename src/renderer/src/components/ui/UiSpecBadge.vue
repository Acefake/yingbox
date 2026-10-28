<template>
  <span
    class="yb-spec"
    :class="[
      `is-${variant}`,
      {
        'is-hdr': text === 'HDR' || text === 'HDR10',
        'is-vision': variant === 'dolby' && text === 'VISION',
        'yb-glass':
          text === 'HDR' ||
          text === 'HDR10' ||
          (variant === 'dolby' && text === 'VISION'),
      },
    ]"
  >
    <template v-if="variant === 'dolby'">
      <span class="yb-spec-brand">DOLBY</span>
      <span class="yb-spec-line">{{ text }}</span>
    </template>
    <template v-else>{{ text }}</template>
  </span>
</template>

<script setup lang="ts">
/**
 * 规格标签（Apple TV 式）：4K / HDR10 实心小方块，DOLBY VISION 单行文字标，ATMOS 双行文字标，
 * CC / 中字描边小方块，16+ 分级圆标。样式是全局的 .yb-spec（ui.css），颜色取 --spec-*。
 */
import type { SpecVariant } from './spec-badge'

defineProps<{
  variant: SpecVariant
  /** 标签文字；dolby 为第二行（VISION / ATMOS） */
  text: string
}>()
</script>
