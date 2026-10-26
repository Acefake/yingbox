import {
  type Ref,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue'

import { useShellBackdrop } from '@/composables/use-shell-backdrop'

import { heroBackdropAt } from './detail-view'

/** 顶部渐隐带高度，与 item-detail.css 的 .lib-detail-edge 一致 */
const EDGE_HEIGHT = 104

/**
 * 详情页浮动控件的底色跟着滚动位置走：Hero（深色画面）在身后时用深色，滚到页面底色上时回主题色。
 * - `edgeOnMedia`：顶部渐隐带与返回圆钮；窗口键胶囊（经 useShellBackdrop 交给外壳）跟它一起切换
 * - 侧栏经 useShellBackdrop 交给外壳，Hero 占不到半个窗口就回主题玻璃
 * 滚动时每帧最多算一次；窗口尺寸变化（Hero 高度随之变）时重算；keep-alive 停用时撤回外壳声明。
 *
 * @param root 滚动容器，Hero 是其中 data-tab="overview" 的直接子元素
 */
export function useHeroBackdrop(root: Ref<HTMLElement | null>): {
  edgeOnMedia: Ref<boolean>
  onScroll: () => void
  update: () => void
} {
  const edgeOnMedia = ref(true)
  const setShell = useShellBackdrop()
  let frame = 0
  let active = true

  function update(): void {
    const el = root.value
    const hero = el?.querySelector<HTMLElement>(
      ':scope > [data-tab="overview"]'
    )
    if (!el || !hero) {
      edgeOnMedia.value = false
      setShell({ sidebar: false, toolbar: false })
      return
    }
    // 浅色主题下 Hero 最后 --hero-detail-fade 一段渐隐成页面底色，深色画面的下沿取渐隐段起点
    const fade = parseFloat(
      getComputedStyle(hero).getPropertyValue('--hero-detail-fade')
    )
    const bottom =
      hero.offsetTop +
      hero.offsetHeight -
      el.scrollTop -
      (Number.isFinite(fade) ? fade : 0)
    const at = heroBackdropAt(bottom, el.clientHeight, EDGE_HEIGHT)
    edgeOnMedia.value = at.edge
    setShell({ sidebar: active && at.sidebar, toolbar: active && at.edge })
  }

  function onScroll(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }

  onMounted(() => window.addEventListener('resize', onScroll))
  onActivated(() => {
    active = true
    update()
  })
  onDeactivated(() => {
    active = false
    setShell({ sidebar: false, toolbar: false })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onScroll)
    if (frame) cancelAnimationFrame(frame)
  })

  return { edgeOnMedia, onScroll, update }
}
