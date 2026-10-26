<template>
  <!-- 底部玻璃胶囊：页内分区导航，选中项是更亮的内胶囊；首屏（Hero 在身后）时淡出且不可聚焦 -->
  <nav
    class="lib-detail-tabs yb-glass"
    :class="{ 'is-concealed': !shown }"
    aria-label="页内分区"
    :aria-hidden="shown ? undefined : 'true'"
    :inert="!shown"
  >
    <UiPressable
      v-for="tab in tabs"
      :key="tab.key"
      class="lib-detail-tab"
      :aria-current="tab.key === active ? 'true' : undefined"
      @click="emit('jump', tab.key)"
    >
      {{ tab.label }}
    </UiPressable>
  </nav>
</template>

<script setup lang="ts">
/**
 * 详情页底部的分区胶囊（效果图 D-1）：在内容区（侧栏右边）居中，压在文字上所以玻璃更厚；
 * 窄屏隐藏。首屏它会盖住第一排剧集卡，所以 Hero 底边升过视口一半前淡出（判定见 detailTabsShownAt，状态来自 useHeroBackdrop）。
 * 选中与滚动跟随在 use-detail-tabs。
 */
import UiPressable from '@/components/ui/UiPressable.vue'

import type { DetailTab, DetailTabKey } from './detail-view'

defineProps<{
  tabs: DetailTab[]
  /** 当前分区 */
  active: DetailTabKey
  /** 是否显示；false 时淡出并移出焦点顺序 */
  shown: boolean
}>()
const emit = defineEmits<{ jump: [key: DetailTabKey] }>()
</script>

<style scoped>
.lib-detail-tabs {
  position: absolute;
  bottom: var(--space-5);
  left: calc(var(--shell-left, 0px) + (100% - var(--shell-left, 0px)) / 2);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 56px;
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
  /* 压在文字上，玻璃要更厚才读得清（降低透明度时 --glass-bg 即实色，结果仍是实色） */
  background: color-mix(in srgb, var(--glass-solid) 70%, var(--glass-bg));
  transform: translateX(-50%);
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out),
    visibility 0s;
}
.lib-detail-tabs.is-concealed {
  visibility: hidden;
  opacity: 0;
  transform: translate(-50%, var(--space-3));
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out),
    visibility 0s var(--duration-normal);
}
.lib-detail-tab {
  height: var(--shell-pill-height);
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  transition:
    background var(--duration-fast) ease,
    color var(--duration-fast) ease;
}
.lib-detail-tab:hover {
  color: var(--text-primary);
}
.lib-detail-tab[aria-current='true'] {
  background: var(--bg-active);
  box-shadow: inset 0 1px 0.5px var(--border-glass-light);
  color: var(--text-primary);
}

@media (max-width: 720px) {
  .lib-detail-tabs {
    display: none;
  }
}
</style>
