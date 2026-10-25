<template>
  <section class="yb-shelf" :aria-label="label || title">
    <UiSectionHeader
      :title="title"
      :more="more"
      :more-label="moreLabel"
      @more="emit('more')"
    >
      <slot name="actions" />
      <span v-if="!grid && overflow" class="yb-shelf-nav">
        <UiIconButton
          icon="back"
          label="向左滚动"
          size="sm"
          variant="secondary"
          :disabled="atStart"
          @click="scrollBy(-1)"
        />
        <UiIconButton
          icon="forward"
          label="向右滚动"
          size="sm"
          variant="secondary"
          :disabled="atEnd"
          @click="scrollBy(1)"
        />
      </span>
    </UiSectionHeader>
    <div
      ref="track"
      class="yb-shelf-track"
      :class="[`is-${kind}`, { 'is-grid': grid }]"
      @scroll.passive="syncEdges"
    >
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 一排卡片（Apple TV 的 shelf）：分区标题 + 横向滚动的轨道，内容超出时标题行右侧出左右滚动键。
 *
 * 滚动键平时隐藏，指针移进这一排或键盘焦点在里面时出现（触屏一直显示）。
 * - kind="landscape"：横版剧照卡，一行 4 张按宽度自适应（窄时 3 张，手机一张半）；
 * - kind="portrait"：竖版海报，按宽度约 7 张，最后一张露出一截提示还能滚；
 * - grid：换行铺开（「查看全部」展开时）。
 * 轨道的直接子元素就是一张卡，宽度由这里定，卡片自己不写宽。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import UiIconButton from './UiIconButton.vue'
import UiSectionHeader from './UiSectionHeader.vue'

withDefaults(
  defineProps<{
    title: string
    /** 区域的无障碍名称；默认用标题 */
    label?: string
    kind?: 'landscape' | 'portrait'
    more?: boolean
    moreLabel?: string
    grid?: boolean
  }>(),
  { kind: 'landscape' }
)
const emit = defineEmits<{ more: [] }>()

const track = ref<HTMLElement | null>(null)
const atStart = ref(true)
const atEnd = ref(true)
const overflow = ref(false)

/** 同步滚动位置：两端键的可用状态、是否超出一屏 */
function syncEdges(): void {
  const el = track.value
  if (!el) return
  atStart.value = el.scrollLeft <= 1
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
  overflow.value = el.scrollWidth > el.clientWidth + 1
}

function scrollBy(direction: 1 | -1): void {
  const el = track.value
  if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8 })
}

// 卡片增减、窗口变宽变窄都会改变是否超出
let observer: ResizeObserver | null = null
let mutations: MutationObserver | null = null
onMounted(() => {
  const el = track.value
  if (!el) return
  void nextTick(syncEdges)
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(syncEdges)
    observer.observe(el)
  }
  if (typeof MutationObserver !== 'undefined') {
    mutations = new MutationObserver(() => void nextTick(syncEdges))
    mutations.observe(el, { childList: true })
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  mutations?.disconnect()
})

defineExpose({ syncEdges })
</script>

<style>
.yb-shelf {
  min-width: 0;
  container-type: inline-size;
}
.yb-shelf-nav {
  display: inline-flex;
  gap: var(--space-2);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.yb-shelf:hover .yb-shelf-nav,
.yb-shelf:focus-within .yb-shelf-nav {
  opacity: 1;
}
@media (hover: none) {
  .yb-shelf-nav {
    opacity: 1;
  }
}
/* 上下留白给悬停放大和阴影；左右负边距让卡片边缘和标题对齐 */
.yb-shelf-track {
  --shelf-gap: 18px; /* style-tokens: layout（Apple TV 卡片间距） */
  --shelf-cols: 4;
  display: flex;
  gap: var(--shelf-gap);
  margin: calc(var(--space-3) * -1) calc(var(--space-2) * -1);
  padding: var(--space-3) var(--space-2);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-behavior: smooth;
  scroll-padding-inline: var(--space-2);
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.yb-shelf-track::-webkit-scrollbar {
  display: none;
}
.yb-shelf-track > * {
  flex: 0 0
    calc(
      (100% - var(--shelf-gap) * (var(--shelf-cols) - 1)) / var(--shelf-cols)
    );
  min-width: 0;
  scroll-snap-align: start;
}
/* 竖版海报：约 7 张，最后一张露出一截 */
.yb-shelf-track.is-portrait {
  --shelf-cols: 6.2;
}
@container (max-width: 820px) {
  .yb-shelf-track.is-landscape {
    --shelf-cols: 3;
  }
  .yb-shelf-track.is-portrait {
    --shelf-cols: 4.6;
  }
}
@container (max-width: 560px) {
  .yb-shelf-track.is-landscape {
    --shelf-cols: 1.6;
  }
  .yb-shelf-track.is-portrait {
    --shelf-cols: 3.3;
  }
}
.yb-shelf-track.is-grid {
  flex-wrap: wrap;
  row-gap: var(--space-6);
  overflow: visible;
}
.yb-shelf-track.is-grid.is-portrait {
  --shelf-cols: 7;
}
@media (prefers-reduced-motion: reduce) {
  .yb-shelf-track {
    scroll-behavior: auto;
  }
}
</style>
