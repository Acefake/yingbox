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
          <div v-if="cell.item" class="lib-cell-preview ui-preview-layer" />
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
 * - 海报取 300w 本地缩略图，loading=lazy + decoding=async，解码不占主线程；
 * - 格子构造、方向键、修饰键等纯规则在 wall-cells.ts，样式在 poster-wall.css；
 * - 悬停预览也委托在网格上（useGridPreview，来源见 wall-preview.ts），多选时不起；
 *   格子被回收（滚出渲染区间、换查询）时停止。
 */
import { type CSSProperties, computed, nextTick, ref, toRef, watch } from 'vue'

import { useGridPreview } from '@/components/ui/hover-preview'

import type { LibraryItemSummary } from '../../../../../shared/library/ipc'
import { itemImage } from '../api/images'
import { formatRating } from '../shared/format'
import type { PagedList } from './paged-list'
import { useVirtualGrid } from './use-virtual-grid'
import { wallPreviewSource } from './wall-preview'
import {
  type Cell,
  arrowTarget,
  buildCells,
  clickModifiers,
  loadedIds,
} from './wall-cells'

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
    shown = loadedIds(range.value.start, range.value.end, i => props.list.at(i))
  },
  { immediate: true }
)

const cells = computed<Cell[]>(() => {
  void props.version
  void props.selectionVersion
  return buildCells({
    start: range.value.start,
    end: range.value.end,
    at: i => props.list.at(i),
    offset,
    deferImages: fast.value,
    shown,
    selected: props.selected,
    showStateBadge: Boolean(props.showStateBadge),
    image: poster => itemImage(poster, 300),
    rating: formatRating,
  })
})

const preview = useGridPreview(grid, {
  cell: '.lib-cell',
  host: '.lib-cell-preview',
  source: cell => {
    const item = props.list.at(Number(cell.dataset.index))
    return item ? wallPreviewSource(item) : null
  },
  disabled: () => props.selected.size > 0,
})
watch([range, () => props.version], () =>
  nextTick(() => {
    if (preview.activeCell()?.isConnected === false) preview.stop()
  })
)

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
  emit('activate', hit.index, hit.item, clickModifiers(event))
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
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('activate', hit.index, hit.item, clickModifiers(event))
    return
  }
  const next = arrowTarget(
    event.key,
    hit.index,
    metrics.value.columns,
    props.count
  )
  if (next === null) return
  event.preventDefault()
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

<style scoped src="./poster-wall.css"></style>
