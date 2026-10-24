<template>
  <div class="assistant-orb" :data-phase="phase" aria-hidden="true">
    <div class="assistant-orb-scale" :style="scaleStyle">
      <div class="assistant-orb-ball">
        <div class="assistant-orb-spin">
          <i class="assistant-orb-blob is-violet" />
          <i class="assistant-orb-blob is-pink" />
          <i class="assistant-orb-blob is-cyan" />
          <i class="assistant-orb-blob is-amber" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 面板里的大光球：几团模糊的彩色渐变在球里漂移、互相叠加，看起来在不断变形。
 *
 * 各阶段的动画：待命缓慢漂移；聆听中随真实音量（level，0–1）放大；思考中整体旋转、漂移加快；
 * 回答中轻微脉动。全部是 CSS 的 transform / opacity 动画，聆听时只改一个元素的 transform。
 * 样式在 assistant.css；减少动态效果时只保留静态光球。
 */
import { computed } from 'vue'

import type { AssistantPhase } from './use-assistant'

const props = withDefaults(
  defineProps<{ phase: AssistantPhase; level?: number }>(),
  { level: 0 }
)

/** 聆听时按音量放大（最多 1.22 倍） */
const scaleStyle = computed(() =>
  props.phase === 'listening'
    ? {
        transform: `scale(${(1 + Math.min(1, props.level) * 0.22).toFixed(3)})`,
      }
    : undefined
)
</script>
