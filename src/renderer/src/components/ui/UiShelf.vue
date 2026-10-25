<template>
  <section class="yb-shelf" :aria-label="label || title">
    <UiSectionHeader
      :title="title"
      :more="more"
      :more-label="moreLabel"
      @more="emit('more')"
    >
      <template v-if="$slots.title" #title><slot name="title" /></template>
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
    <slot name="intro" />
    <div
      ref="track"
      class="yb-shelf-track"
      :class="[`is-${kind}`, { 'is-grid': grid }]"
      :role="list ? 'list' : undefined"
      @scroll.passive="syncEdges"
      @wheel="onWheel"
      @keydown="onKeydown"
    >
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 一排卡片（Apple TV 的 shelf）：分区标题 + 横向滚动的轨道，内容超出时标题行右侧出左右翻页键（一次翻约一屏）。
 *
 * 横向翻页的几种方式：翻页键；触控板横滑（原生）；鼠标滚轮（只认整格的滚轮、不认触控板竖滑，
 * 竖向一格转成横向，翻到头时把滚轮还给页面）；键盘焦点在卡片上时 ← / → 移到相邻一张。
 * 插槽：title 换掉标题（如选季下拉），actions 放标题行右侧的小控件，intro 放标题与轨道之间的说明。
 * - kind="landscape"：横版剧照卡，一行 4 张按宽度自适应（窄时 3 张，手机一张半）；
 *   卡片要固定宽度时在调用处改轨道子元素的 flex-basis（如详情剧集卡约 300px）；
 * - kind="portrait"：竖版海报，按宽度约 7 张，最后一张露出一截提示还能滚；
 * - grid：换行铺开（「查看全部」展开时）；
 * - list：轨道带 role="list"（卡片是一组同类条目时，读屏播报「N 项列表」），卡片自己写 role="listitem"。
 * 轨道的直接子元素就是一张卡，宽度由这里定，卡片自己不写宽。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import UiIconButton from './UiIconButton.vue'
import UiSectionHeader from './UiSectionHeader.vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** 区域的无障碍名称；默认用标题 */
    label?: string
    kind?: 'landscape' | 'portrait'
    more?: boolean
    moreLabel?: string
    grid?: boolean
    /** 轨道按列表播报（卡片各自带 role="listitem"） */
    list?: boolean
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

/**
 * 鼠标滚轮：只处理整格滚动（deltaMode 为行 / 页，或像素模式下一格 ≥ 40px 且没有横向分量），
 * 触控板的细碎竖滑照常滚页面。还能往滚动方向走时转成横向（一格一张卡）并拦下，到头了不拦，页面接着滚。
 */
function onWheel(event: WheelEvent): void {
  const el = track.value
  if (!el || props.grid || event.shiftKey || event.ctrlKey) return
  if (event.deltaX !== 0 || event.deltaY === 0) return
  const notch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 40
  if (!notch) return
  const forward = event.deltaY > 0
  const canMove = forward
    ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    : el.scrollLeft > 1
  if (!canMove) return
  event.preventDefault()
  // 一格走一张卡（卡宽 + 间距）：走不满一张时 scroll-snap 会把位置吸回原来那张
  const card = el.firstElementChild?.getBoundingClientRect().width ?? 0
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0
  const step = Math.max(card + gap, el.clientWidth * 0.25)
  el.scrollBy({ left: forward ? step : -step })
}

/** ← / →：焦点在某张卡里时移到相邻一张卡里的第一个可聚焦元素（滚动跟着走） */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const el = track.value
  const target = event.target as HTMLElement | null
  if (!el || !target || target.matches('input, textarea, select')) return
  const card = [...el.children].find(child => child.contains(target))
  const next =
    event.key === 'ArrowRight'
      ? card?.nextElementSibling
      : card?.previousElementSibling
  const focusable = next?.querySelector<HTMLElement>(
    'button, a[href], [tabindex]:not([tabindex="-1"])'
  )
  if (!focusable) return
  event.preventDefault()
  focusable.focus()
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
/* 翻页键：内容超出时一直显示（到头的一侧变灰），指针移进这一排时更醒目 */
.yb-shelf-nav {
  display: inline-flex;
  gap: var(--space-2);
  opacity: 0.72;
  transition: opacity var(--duration-fast) ease;
}
.yb-shelf:hover .yb-shelf-nav,
.yb-shelf:focus-within .yb-shelf-nav {
  opacity: 1;
}
/* 上下留白给悬停放大和阴影；左右负边距让卡片边缘和标题对齐 */
.yb-shelf-track {
  --shelf-gap: 18px; /* style-tokens: layout（Apple TV 卡片间距） */
  --shelf-cols: 4;
  display: flex;
  gap: var(--shelf-gap);
  margin: calc(var(--space-3) * -1) calc(var(--space-2) * -1);
  /* --shelf-bleed：页面右侧留白的宽度，这一排在右边铺到窗口边（卡片宽度不变，最后一张露出一截） */
  margin-right: calc((var(--space-2) + var(--shelf-bleed, 0px)) * -1);
  padding: var(--space-3) var(--space-2);
  padding-right: calc(var(--space-2) + var(--shelf-bleed, 0px));
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
