import { type Ref, onBeforeUnmount, ref, watch } from 'vue'

import {
  type DetailTab,
  type DetailTabKey,
  activeTabAt,
  keepTab,
} from './detail-view'

/** scrollend 没来时（目标就是当前位置、环境不支持）最多这么久后恢复跟随滚动 */
const JUMP_FALLBACK_MS = 1500

/**
 * 详情页底部分区胶囊的状态：滚动时跟随当前分区（每帧最多算一次），点胶囊平滑滚过去。
 *
 * 点击滚动途中不跟随滚动改选中：以滚动容器的 scrollend 为准解除，不按固定时长猜，
 * 长距离或低配机上的平滑滚动也不会中途闪跳；已排队的跟随帧在点击时取消，回调里也再查一次。
 * 分区列表变化（某区块消失）时把选中校正到还存在的分区（keepTab）。
 *
 * @param root 滚动容器，直接子元素用 data-tab 标出各分区
 * @param tabs 当前的分区列表
 */
export function useDetailTabs(
  root: Ref<HTMLElement | null>,
  tabs: Ref<DetailTab[]>
): {
  activeTab: Ref<DetailTabKey>
  onScroll: () => void
  jumpTo: (key: DetailTabKey) => void
  reset: () => void
} {
  const activeTab = ref<DetailTabKey>('overview')
  let jumping = false
  let stopJump: (() => void) | null = null
  let frame = 0

  /** 各分区相对滚动内容顶部的位置，按页面顺序 */
  function sectionTops(
    el: HTMLElement
  ): Array<{ key: DetailTabKey; top: number }> {
    return [...el.querySelectorAll<HTMLElement>(':scope > [data-tab]')].map(
      section => ({
        key: section.dataset.tab as DetailTabKey,
        top: section.offsetTop,
      })
    )
  }

  function follow(): void {
    const el = root.value
    if (!el) return
    const key = activeTabAt(
      sectionTops(el),
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight
    )
    if (key) activeTab.value = key
  }

  function onScroll(): void {
    if (frame || jumping) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!jumping) follow()
    })
  }

  function cancelFrame(): void {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  function endJump(): void {
    stopJump?.()
    stopJump = null
    jumping = false
  }

  function jumpTo(key: DetailTabKey): void {
    const el = root.value
    const section = el?.querySelector<HTMLElement>(
      `:scope > [data-tab="${key}"]`
    )
    if (!el || !section) return
    cancelFrame()
    endJump()
    activeTab.value = key
    jumping = true
    const done = (): void => endJump()
    const timer = setTimeout(done, JUMP_FALLBACK_MS)
    el.addEventListener('scrollend', done, { once: true })
    stopJump = () => {
      clearTimeout(timer)
      el.removeEventListener('scrollend', done)
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({
      top: key === 'overview' ? 0 : section.offsetTop - 24,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  /** 换条目时回到概览 */
  function reset(): void {
    cancelFrame()
    endJump()
    activeTab.value = 'overview'
  }

  watch(tabs, list => (activeTab.value = keepTab(list, activeTab.value)))
  onBeforeUnmount(() => {
    cancelFrame()
    endJump()
  })

  return { activeTab, onScroll, jumpTo, reset }
}
