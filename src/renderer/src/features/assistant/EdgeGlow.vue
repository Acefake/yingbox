<template>
  <div class="edge-glow" :data-phase="phase" aria-hidden="true">
    <div class="edge-glow-layer is-halo">
      <div class="edge-glow-ring"><div class="edge-glow-spin" /></div>
    </div>
    <div class="edge-glow-layer">
      <div class="edge-glow-ring"><div class="edge-glow-spin" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 窗口边缘的彩色光圈：一圈细线 + 一圈模糊的外发光，里面是旋转的 conic 渐变（紫 / 粉 / 琥珀 / 青）。
 *
 * 只旋转一个大方块（transform），用 mask 挖空中间，只留边缘一圈；思考中转得更快，聆听中外发光呼吸。
 * 浮层关闭时随父组件卸载，动画随之停止；减少动态效果时不转。样式在 assistant.css。
 */
import type { AssistantPhase } from './use-assistant'

defineProps<{ phase: AssistantPhase }>()
</script>
