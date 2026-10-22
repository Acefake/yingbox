<template>
  <component
    :is="tag"
    ref="root"
    class="ui-virtual"
    :style="{
      paddingTop: `${range.padTop}px`,
      paddingBottom: `${range.padBottom}px`,
    }"
  >
    <template
      v-for="(item, i) in visible"
      :key="itemKey(item, range.start + i)"
    >
      <slot :item="item" :index="range.start + i" />
    </template>
  </component>
</template>

<script setup lang="ts" generic="T">
/**
 * 虚拟网格 / 列表：只渲染视口附近的行，长列表滚动时 DOM 节点数恒定。
 *
 * 用法：把原来 `<div class="ui-poster-grid"><Card v-for …/></div>` 换成
 * `<UiVirtualGrid class="ui-poster-grid" :items :item-key><template #default="{ item }"><Card/></template></UiVirtualGrid>`。
 * 一维列表同理，传 `tag="ul"`、插槽里放 `<li>`，非 grid 容器按 1 列算。
 * 组件只有一个根元素（就是网格容器本身），class 和父组件的 scoped 样式都落在它上面。
 * 上下占位用的是它的 padding-top / padding-bottom，所以网格 class 不要再设纵向 padding。
 *
 * - 列数：读容器解析后的 `grid-template-columns`，所以 `auto-fill` / 媒体查询照常生效，
 *   窗口缩放时由 ResizeObserver 重新计算（可变列数）。
 * - 行距：取已渲染首行到末行顶部的平均间距（含 gap 和外边距）。要求各行基本等高，
 *   海报卡靠 aspect-ratio + 单行标题保证；行高随内容大幅变化的列表不要用它。
 * - 滚动容器：默认找最近的 overflow-y 为 auto / scroll 的祖先（找不到用窗口），也可用 scroller 指定。
 *   上方可以有标题等其他内容，偏移按 getBoundingClientRect 实时算。
 * - 上下用 padding 撑出被跳过的行，滚动条长度与全部渲染时一致，外层「滚到底加载更多」不用改。
 * - 无限滚动：渲染区间到了最后一条时发 reach-end（量好行距之后；条数变了仍在底部会再发一次，
 *   这样一页不够铺满视口时会接着要下一页）。外层自己防重复（加载中、到底、失败时忽略）。
 */
import {
  type Ref,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
} from 'vue'
import {
  countColumns,
  isAtEnd,
  measureStride,
  visibleRange,
} from './virtual-range'

const props = withDefaults(
  defineProps<{
    items: T[]
    /** 每条的稳定 key（index 是在 items 里的下标） */
    itemKey: (item: T, index: number) => string | number
    /** 容器标签，列表用 ul */
    tag?: string
    /** 视口上下多渲染的行数 */
    overscan?: number
    /** 指定滚动容器；不传则自动找 */
    scroller?: HTMLElement | null
  }>(),
  { tag: 'div', overscan: 2, scroller: null }
)

defineSlots<{ default(props: { item: T; index: number }): unknown }>()
const emit = defineEmits<{ 'reach-end': [] }>()

const root = ref<HTMLElement | null>(null)
const columns = ref(1)
const stride = ref(0)
const viewTop = ref(0)
const viewHeight = ref(0)

const range = computed(() =>
  visibleRange({
    count: props.items.length,
    columns: columns.value,
    stride: stride.value,
    viewTop: viewTop.value,
    viewHeight: viewHeight.value,
    overscan: props.overscan,
  })
)
const visible = computed(() =>
  props.items.slice(range.value.start, range.value.end)
)

let scrollTarget: HTMLElement | null = null
let frame = 0
let observer: ResizeObserver | null = null

/** 最近的纵向滚动祖先 */
function findScroller(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
      return node
  }
  return null
}

function setIfChanged(target: Ref<number>, value: number): void {
  if (Math.abs(target.value - value) >= 0.5) target.value = value
}

/** 量列数与行距（渲染内容变化后调用） */
function measureLayout(): void {
  const grid = root.value
  if (!grid || !grid.children.length) return
  const style = getComputedStyle(grid)
  const cols = countColumns(style.gridTemplateColumns)
  const first = grid.children[0] as HTMLElement
  // 已渲染的最后一行的首个元素（与首行相隔 rowsApart 行）
  const rowsApart = Math.floor((grid.children.length - 1) / cols)
  const last =
    rowsApart >= 1 ? (grid.children[rowsApart * cols] as HTMLElement) : null
  const next = measureStride(
    first.offsetTop,
    first.offsetHeight,
    last ? last.offsetTop : null,
    rowsApart,
    parseFloat(style.rowGap)
  )
  if (cols !== columns.value) columns.value = cols
  if (next > 0) setIfChanged(stride, next)
}

/** 量视口相对列表起点的位置 */
function measureViewport(): void {
  const el = root.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  if (scrollTarget) {
    setIfChanged(viewTop, scrollTarget.getBoundingClientRect().top - top)
    setIfChanged(viewHeight, scrollTarget.clientHeight)
  } else {
    setIfChanged(viewTop, -top)
    setIfChanged(viewHeight, window.innerHeight)
  }
}

function onScroll(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measureViewport()
  })
}

function bind(): void {
  unbind()
  if (!root.value) return
  scrollTarget = props.scroller ?? findScroller(root.value)
  ;(scrollTarget ?? window).addEventListener('scroll', onScroll, {
    passive: true,
  })
  observer = new ResizeObserver(() => {
    measureLayout()
    measureViewport()
  })
  observer.observe(root.value)
  if (scrollTarget) observer.observe(scrollTarget)
  measureLayout()
  measureViewport()
}

function unbind(): void {
  ;(scrollTarget ?? window).removeEventListener('scroll', onScroll)
  observer?.disconnect()
  observer = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

onMounted(bind)
onUpdated(measureLayout)
onBeforeUnmount(unbind)
watch(
  () => props.scroller,
  () => nextTick(bind)
)
// 到底（或到底后条数变了仍在底）通知外层加载更多
watch(
  [
    () => isAtEnd(range.value, props.items.length, stride.value),
    () => props.items.length,
  ],
  ([atEnd]) => {
    if (atEnd) emit('reach-end')
  }
)
// 列表整体替换（换分类、重新搜索）后视口位置可能已经变了
watch(
  () => props.items.length,
  () => nextTick(measureViewport)
)
</script>

<style>
.ui-virtual {
  min-width: 0;
  box-sizing: border-box;
}
</style>
