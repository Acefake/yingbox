/**
 * 悬停预览的 Vue 入口：应用里唯一的控制器 + 两个组合函数。
 *
 * - configureHoverPreview：应用入口把设置（开关、延时）接进来（main.ts，读 settings schema 的
 *   ui.hoverPreview / ui.hoverPreviewDelay，写入只经主进程）；
 * - useCardPreview：一张卡（UiPosterCard）；
 * - useGridPreview：委托到整个网格（媒体库海报墙）；
 * - 两者在组件卸载（UiVirtualGrid 回收）、keep-alive 切走（onDeactivated）时停止；
 *   窗口隐藏（visibilitychange）时全局停止。
 */
import {
  type Ref,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  watchEffect,
} from 'vue'

import {
  type GridPreviewOptions,
  type Unbind,
  bindCardPreview,
  bindGridPreview,
} from './bind'
import { type PreviewController, createPreviewController } from './controller'
import { createDomStage } from './stage'
import {
  DEFAULT_PREVIEW_SETTINGS,
  type PreviewSettings,
  type PreviewSource,
} from './types'

let readSettings: () => PreviewSettings = () => DEFAULT_PREVIEW_SETTINGS
let controller: PreviewController | null = null

/**
 * 应用入口调用：预览设置从哪读（每次悬停时读一次，改了立即生效）。
 * read 是响应式的时，关掉开关会立即停掉正在播的预览。
 */
export function configureHoverPreview(read: () => PreviewSettings): void {
  readSettings = read
  watchEffect(() => {
    if (!read().enabled) controller?.stop()
  })
}

/** 应用里唯一的控制器（首次悬停时创建）。 */
export function hoverPreview(): PreviewController {
  if (controller) return controller
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const created = createPreviewController({
    stage: createDomStage(document),
    settings: () => readSettings(),
    reducedMotion: () => Boolean(motion?.matches),
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) created.stop()
  })
  controller = created
  return created
}

/** 立即停止正在播的预览（没有就什么都不做）。 */
export function stopHoverPreview(): void {
  controller?.stop()
}

/**
 * 一张卡的悬停预览。source 返回 null / undefined 时这张卡不预览，
 * 由有值变为空（如进入多选）时立即停止。
 */
export function useCardPreview(
  el: Ref<HTMLElement | null>,
  host: Ref<HTMLElement | null>,
  source: () => PreviewSource | null | undefined
): void {
  let unbind: Unbind | null = null
  const release = (): void => {
    const key = source()?.key
    if (key && controller?.activeKey() === key) controller.leave(key)
  }
  onMounted(() => {
    if (el.value)
      unbind = bindCardPreview(
        el.value,
        () => host.value,
        source,
        hoverPreview()
      )
  })
  watch(
    () => source()?.key,
    (_next, previous) => {
      if (previous) controller?.leave(previous)
    }
  )
  onDeactivated(release)
  onBeforeUnmount(() => {
    unbind?.()
    unbind = null
  })
}

/**
 * 网格委托的悬停预览。disabled 为真（多选模式）时停止且不再触发。
 * 返回 stop（换查询、格子被回收时调用）与当前格。
 */
export function useGridPreview(
  root: Ref<HTMLElement | null>,
  options: GridPreviewOptions & { disabled?: () => boolean }
): { stop: () => void; activeCell: () => HTMLElement | null } {
  let bound: ReturnType<typeof bindGridPreview> | null = null
  const source = (cell: HTMLElement): PreviewSource | null =>
    options.disabled?.() ? null : options.source(cell)
  onMounted(() => {
    if (root.value)
      bound = bindGridPreview(
        root.value,
        { ...options, source },
        hoverPreview()
      )
  })
  if (options.disabled)
    watch(options.disabled, off => {
      if (off) bound?.stop()
    })
  onDeactivated(() => bound?.stop())
  onBeforeUnmount(() => {
    bound?.unbind()
    bound = null
  })
  return {
    stop: () => bound?.stop(),
    activeCell: () => bound?.activeCell() ?? null,
  }
}
