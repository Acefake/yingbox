/**
 * 虚拟网格的 DOM 绑定：监听滚动容器与网格尺寸，算出应渲染的区间。
 *
 * 性能要点：
 * - 滚动回调只登记一帧（requestAnimationFrame），每帧最多算一次；
 * - 区间没变（还在同一行内滚动）就不写响应式状态，组件不重新渲染；
 * - 尺寸变化用 ResizeObserver，不在滚动时测量；
 * - 一帧滚过半行以上时标记为快速滚动（fast），停下 FAST_IDLE_MS 后清除，
 *   海报墙据此跳过只是一闪而过的格子的图片解码。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
} from 'vue'

import {
  type GridMetrics,
  type GridOptions,
  type GridRange,
  cellOffset,
  contentHeight,
  gridMetrics,
  sameRange,
  visibleRange,
} from './virtual-grid'

/** 快速滚动停下多久后恢复加载图片。 */
const FAST_IDLE_MS = 120

const EMPTY: GridRange = { startRow: 0, endRow: 0, start: 0, end: 0 }

/** 从网格元素的 CSS 变量读网格参数（设计令牌是唯一来源）。 */
function readOptions(el: HTMLElement, fallback: GridOptions): GridOptions {
  const style = getComputedStyle(el)
  const px = (name: string, value: number): number => {
    const parsed = parseFloat(style.getPropertyValue(name))
    return Number.isFinite(parsed) ? parsed : value
  }
  return {
    minCellWidth: px('--poster-min-width', fallback.minCellWidth),
    gapX: px('--poster-gap-x', fallback.gapX),
    gapY: px('--poster-gap-y', fallback.gapY),
    textHeight: px('--poster-text-height', fallback.textHeight),
    aspect: fallback.aspect,
  }
}

/** useVirtualGrid 的返回值。 */
export interface VirtualGrid {
  metrics: Ref<GridMetrics>
  range: Ref<GridRange>
  /** 是否正在快速滚动（一帧超过半行）。 */
  fast: Ref<boolean>
  height: ComputedRef<number>
  offset: (index: number) => { x: number; y: number }
  /** 把第 index 格滚进视口（键盘导航用）。 */
  scrollToIndex: (index: number) => void
}

/** 虚拟网格。 */
export function useVirtualGrid(params: {
  scroller: Ref<HTMLElement | null>
  grid: Ref<HTMLElement | null>
  count: Ref<number>
  options: GridOptions
  overscan?: number
}): VirtualGrid {
  const { scroller, grid, count } = params
  const overscan = params.overscan ?? 3
  let options = params.options
  const metrics = shallowRef<GridMetrics>(gridMetrics(0, options))
  const range = shallowRef<GridRange>(EMPTY)
  const fast = shallowRef(false)
  let fastTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0
  let observer: ResizeObserver | null = null

  function gridTop(): number {
    const g = grid.value
    const s = scroller.value
    if (!g || !s) return 0
    return (
      g.getBoundingClientRect().top -
      s.getBoundingClientRect().top +
      s.scrollTop
    )
  }

  let top = 0
  let lastScrollTop = 0

  function update(): void {
    const s = scroller.value
    if (!s) return
    const delta = Math.abs(s.scrollTop - lastScrollTop)
    lastScrollTop = s.scrollTop
    if (delta > metrics.value.rowStride / 2) {
      fast.value = true
      clearTimeout(fastTimer)
      fastTimer = setTimeout(() => {
        fast.value = false
      }, FAST_IDLE_MS)
    }
    const next = visibleRange(
      metrics.value,
      count.value,
      s.scrollTop - top,
      s.clientHeight,
      overscan
    )
    if (!sameRange(next, range.value)) range.value = next
  }

  function measure(): void {
    const g = grid.value
    if (!g) return
    options = readOptions(g, options)
    const next = gridMetrics(g.clientWidth, options)
    const prev = metrics.value
    if (
      next.columns !== prev.columns ||
      next.cellWidth !== prev.cellWidth ||
      next.rowStride !== prev.rowStride
    ) {
      metrics.value = next
    }
    top = gridTop()
    update()
  }

  function onScroll(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }

  onMounted(() => {
    scroller.value?.addEventListener('scroll', onScroll, { passive: true })
    observer = new ResizeObserver(() => measure())
    if (grid.value) observer.observe(grid.value)
    if (scroller.value) observer.observe(scroller.value)
    measure()
  })

  onBeforeUnmount(() => {
    scroller.value?.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    cancelAnimationFrame(frame)
    clearTimeout(fastTimer)
  })

  watch(count, () => {
    top = gridTop()
    update()
  })

  return {
    metrics,
    range,
    fast,
    height: computed(() =>
      contentHeight(metrics.value, count.value, options.gapY)
    ),
    offset: index => cellOffset(metrics.value, index),
    scrollToIndex(index) {
      const s = scroller.value
      if (!s) return
      const { y } = cellOffset(metrics.value, index)
      const cellTop = top + y
      const cellBottom = cellTop + metrics.value.rowStride
      if (cellTop < s.scrollTop) s.scrollTop = cellTop - options.gapY
      else if (cellBottom > s.scrollTop + s.clientHeight) {
        s.scrollTop = cellBottom - s.clientHeight
      }
    },
  }
}
