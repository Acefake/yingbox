<template>
  <div ref="scroller" class="lib-wall custom-scrollbar">
    <slot name="before" />
    <div
      ref="grid"
      class="lib-wall-grid"
      role="grid"
      :aria-rowcount="rows"
      :aria-label="label"
      :style="gridStyle"
      @click="onClick"
      @dblclick="onDoubleClick"
      @keydown="onKeydown"
      @contextmenu="onContextMenu"
    >
      <div
        v-for="cell in cells"
        :key="cell.key"
        class="lib-cell"
        :class="{
          'is-selected': cell.selected,
          'is-loading': !cell.item,
        }"
        :style="cell.style"
        :data-index="cell.index"
        role="gridcell"
        :tabindex="cell.item ? 0 : -1"
        :aria-label="cell.item?.title"
        :aria-selected="cell.selected || undefined"
      >
        <div class="lib-cell-media">
          <img
            v-if="cell.src"
            :src="cell.src"
            alt=""
            loading="lazy"
            decoding="async"
            draggable="false"
            :width="imgWidth"
            :height="metrics.mediaHeight"
            @load="onImageLoad"
          />
          <span
            v-else-if="cell.item && !cell.item.poster"
            class="lib-cell-fallback"
            >{{ cell.item.title }}</span
          >
          <span v-if="cell.badge" class="lib-cell-badge">{{ cell.badge }}</span>
          <span v-if="cell.rating" class="lib-cell-rating">{{
            cell.rating
          }}</span>
          <svg
            v-if="cell.selected"
            class="lib-cell-check"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="11" />
            <path d="M7 12.5l3.2 3.2L17 9" />
          </svg>
        </div>
        <template v-if="cell.item">
          <div class="lib-cell-title">{{ cell.item.title }}</div>
          <div class="lib-cell-sub">{{ cell.item.year ?? '' }}</div>
        </template>
      </div>
    </div>
    <slot name="after" />
  </div>
</template>

<script setup lang="ts">
/**
 * 海报墙：虚拟滚动网格，只渲染视口附近的几十格。
 *
 * - 格子内联在本组件模板里（不拆子组件），点击、键盘、右键都在网格上委托处理，
 *   每格没有自己的监听器和组件实例；
 * - 每格只有 transform 随位置变化，宽高走网格上的 CSS 变量；
 * - 海报取 300w 本地缩略图，loading=lazy + decoding=async，解码不占主线程。
 */
import { type CSSProperties, computed, ref, toRef, watch } from 'vue'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import { itemImage } from '../api/images'
import { formatRating } from '../shared/format'
import type { PagedList } from './paged-list'
import { useVirtualGrid } from './use-virtual-grid'

const props = defineProps<{
  list: PagedList
  /** list 的内容版本（PagedList 不是响应式的）。 */
  version: number
  count: number
  selected: ReadonlySet<number>
  selectionVersion: number
  label: string
  /** 是否在海报上显示待确认 / 未匹配角标。 */
  showStateBadge?: boolean
}>()

const emit = defineEmits<{
  /** 区间变化：父组件据此按需加载页。 */
  visible: [start: number, end: number]
  /** 单击 / 回车 / 双击；modifiers 区分多选。 */
  activate: [
    index: number,
    item: LibraryItemSummary,
    modifiers: { toggle: boolean; range: boolean; double: boolean },
  ]
  contextmenu: [index: number, item: LibraryItemSummary, event: MouseEvent]
}>()

const scroller = ref<HTMLElement | null>(null)
const grid = ref<HTMLElement | null>(null)

/** 文字区高度：标题 + 年份 + 上间距（与样式一致）。 */
const TEXT_HEIGHT = 52

const { metrics, range, fast, height, offset, scrollToIndex } = useVirtualGrid({
  scroller,
  grid,
  count: toRef(props, 'count'),
  options: {
    minCellWidth: 160,
    gapX: 24,
    gapY: 32,
    textHeight: TEXT_HEIGHT,
    aspect: 1.5,
  },
  overscan: 2,
})

const rows = computed(() => Math.ceil(props.count / metrics.value.columns))
const imgWidth = computed(() => Math.round(metrics.value.cellWidth))

const gridStyle = computed<CSSProperties>(() => ({
  height: `${height.value}px`,
  '--cell-w': `${metrics.value.cellWidth}px`,
  '--media-h': `${metrics.value.mediaHeight}px`,
  '--poster-text-height': `${TEXT_HEIGHT}px`,
}))

const BADGES: Partial<Record<LibraryItemSummary['matchState'], string>> = {
  review: '待确认',
  unmatched: '未匹配',
}

watch(range, r => emit('visible', r.start, r.end), { immediate: true })

/**
 * 快速滚动时只给“已经显示过图片”的格子 src，飞过去的格子先画占位，停下后再加载，
 * 省掉一大批马上就离开视口的图片解码。停下时把当前区间都记为已显示。
 */
let shown = new Set<number>()
watch(
  [fast, range],
  () => {
    if (fast.value) return
    const next = new Set<number>()
    for (let i = range.value.start; i < range.value.end; i++) {
      const item = props.list.at(i)
      if (item) next.add(item.id)
    }
    shown = next
  },
  { immediate: true }
)

/** 一个渲染格。 */
interface Cell {
  key: number | string
  index: number
  item: LibraryItemSummary | undefined
  src: string | null
  badge: string
  rating: string
  selected: boolean
  style: CSSProperties
}

const cells = computed<Cell[]>(() => {
  void props.version
  void props.selectionVersion
  const { start, end } = range.value
  const deferImages = fast.value
  const out: Cell[] = []
  for (let index = start; index < end; index++) {
    const item = props.list.at(index)
    const { x, y } = offset(index)
    out.push({
      key: item ? item.id : `p${index}`,
      index,
      item,
      src:
        item && (!deferImages || shown.has(item.id))
          ? itemImage(item.poster, 300)
          : null,
      badge:
        item && props.showStateBadge ? (BADGES[item.matchState] ?? '') : '',
      rating: item ? formatRating(item.rating) : '',
      selected: item ? props.selected.has(item.id) : false,
      style: { transform: `translate3d(${x}px, ${y}px, 0)` },
    })
  }
  return out
})

function cellFrom(event: Event): {
  index: number
  item: LibraryItemSummary
} | null {
  const el = (event.target as HTMLElement).closest<HTMLElement>('.lib-cell')
  if (!el) return null
  const index = Number(el.dataset.index)
  const item = props.list.at(index)
  return item ? { index, item } : null
}

function onClick(event: MouseEvent): void {
  const hit = cellFrom(event)
  if (!hit) return
  emit('activate', hit.index, hit.item, {
    toggle: event.metaKey || event.ctrlKey,
    range: event.shiftKey,
    double: false,
  })
}

function onDoubleClick(event: MouseEvent): void {
  const hit = cellFrom(event)
  if (hit) {
    emit('activate', hit.index, hit.item, {
      toggle: false,
      range: false,
      double: true,
    })
  }
}

function onContextMenu(event: MouseEvent): void {
  const hit = cellFrom(event)
  if (!hit) return
  event.preventDefault()
  emit('contextmenu', hit.index, hit.item, event)
}

/** 方向键在格子间移动焦点，回车 / 空格打开。 */
function onKeydown(event: KeyboardEvent): void {
  const hit = cellFrom(event)
  if (!hit) return
  const columns = metrics.value.columns
  const moves: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns,
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('activate', hit.index, hit.item, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      double: false,
    })
    return
  }
  const delta = moves[event.key]
  if (delta === undefined) return
  event.preventDefault()
  const next = Math.min(props.count - 1, Math.max(0, hit.index + delta))
  scrollToIndex(next)
  // 目标格可能刚进入渲染区间，等这一帧渲染后再聚焦
  requestAnimationFrame(() => {
    grid.value
      ?.querySelector<HTMLElement>(`.lib-cell[data-index="${next}"]`)
      ?.focus({ preventScroll: true })
  })
}

function onImageLoad(event: Event): void {
  ;(event.target as HTMLElement).dataset.loaded = ''
}

defineExpose({
  /** 回到顶部（换查询条件时）。 */
  scrollToTop: () => scroller.value?.scrollTo({ top: 0 }),
  scroller,
})
</script>

<style scoped>
.lib-wall {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.lib-wall-grid {
  position: relative;
  margin: 0 var(--content-padding-x) var(--space-10);
  contain: layout style;
}
.lib-cell {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--cell-w);
  height: calc(var(--media-h) + var(--poster-text-height));
  outline: none;
  cursor: pointer;
  contain: layout style;
  content-visibility: auto;
  contain-intrinsic-size: var(--cell-w)
    calc(var(--media-h) + var(--poster-text-height));
  will-change: transform;
}
.lib-cell-media {
  position: relative;
  height: var(--media-h);
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-fill-secondary);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out);
}
.lib-cell:hover .lib-cell-media {
  transform: translateY(-4px) scale(1.02);
}
.lib-cell:focus-visible .lib-cell-media {
  box-shadow: var(--focus-ring-offset);
}
.lib-cell.is-selected .lib-cell-media {
  box-shadow:
    0 0 0 3px var(--bg-content),
    0 0 0 5px var(--accent);
}
.lib-cell-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.lib-cell-media img[data-loaded] {
  opacity: 1;
}
.lib-cell-fallback {
  display: flex;
  align-items: flex-end;
  height: 100%;
  padding: var(--space-4);
  overflow: hidden;
  color: var(--text-tertiary);
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  word-break: break-word;
}
.lib-cell-badge,
.lib-cell-rating {
  position: absolute;
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--overlay-scrim);
  color: var(--media-text);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}
.lib-cell-badge {
  top: var(--space-2);
  left: var(--space-2);
}
.lib-cell-rating {
  bottom: var(--space-2);
  left: var(--space-2);
}
.lib-cell-check {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  width: 22px;
  height: 22px;
}
.lib-cell-check circle {
  fill: var(--accent);
  stroke: var(--media-text);
  stroke-width: 1.5;
}
.lib-cell-check path {
  fill: none;
  stroke: var(--text-on-accent);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lib-cell-title {
  margin-top: var(--space-3);
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-cell-sub {
  margin-top: var(--space-1);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .lib-cell-media img {
    opacity: 1;
  }
}
</style>
