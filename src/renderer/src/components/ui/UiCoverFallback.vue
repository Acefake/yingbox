<template>
  <div class="ui-cover-fallback" :style="{ background: coverGradient(title) }">
    <span v-if="!hideTitle">{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 封面兜底：由片名算出的渐变色块，换掉加载失败时的灰块。海报上写片名；
 * 横版剧照卡底部自己有片名，传 hideTitle 只留渐变。
 * 父级需要是定位元素（海报、剧照卡的画面区），本组件铺满该区域。
 */
import { coverGradient } from './cover-fallback'

defineProps<{
  title: string
  /** 色块上不写片名（横版剧照卡底部已有） */
  hideTitle?: boolean
}>()
</script>

<style>
.ui-cover-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  color: var(--media-text);
  text-align: center;
}
.ui-cover-fallback span {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-tight);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
</style>
