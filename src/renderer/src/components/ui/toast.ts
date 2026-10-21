import { h, reactive, readonly, render } from 'vue'

import UiToastHost from './UiToastHost.vue'

/**
 * toast：顶部居中的轻提示（macOS HUD 风格），命令式调用，任何地方都能用。
 *
 * ```ts
 * toast.success('已保存')
 * toast.error(err.message)
 * const done = toast.loading('正在解析…') // 不会自动消失
 * try { await work() } finally { done() }
 * ```
 *
 * 规则：
 * - 每种提示有默认停留时间（错误比成功久），`duration: 0` 表示不自动消失；
 * - 同一种类、同一句话正在显示时不再叠一条，只重新计时（连点按钮不会刷屏）；
 * - 最多同时显示 {@link MAX_TOASTS} 条，超出时挤掉最早的一条；
 * - 每个调用都返回关闭函数，可以提前收起。
 *
 * 宿主组件 UiToastHost 在第一次提示时才挂到 body 上；没有 DOM（单测、SSR）时只维护队列。
 */

/** 提示种类：决定图标、停留时间和读屏方式（error 用 role=alert 立即播报） */
export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading'

/** 队列里的一条提示 */
export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

export interface ToastOptions {
  /** 停留毫秒数；0 表示不自动消失。缺省按种类取 {@link TOAST_DURATION} */
  duration?: number
}

/** 收起这条提示；重复调用无副作用 */
export type ToastDismiss = () => void

/** 各种类的默认停留时间（毫秒）。loading 需要调用方手动关闭 */
export const TOAST_DURATION: Readonly<Record<ToastKind, number>> = {
  success: 2500,
  info: 2500,
  warning: 3500,
  error: 4500,
  loading: 0,
}

/** 同时显示的上限 */
export const MAX_TOASTS = 3

const state = reactive<{ items: ToastItem[] }>({ items: [] })
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1
let host: HTMLElement | null = null

/** 当前显示中的提示（只读），供宿主组件渲染和单测断言 */
export const toastItems: readonly Readonly<ToastItem>[] = readonly(state.items)

/** 第一次提示时把宿主挂到 body；宿主是 manual popover，能叠在模态对话框之上 */
function ensureHost(): void {
  if (typeof document === 'undefined') return
  if (!host) {
    host = document.createElement('div')
    host.className = 'ui-toast-layer'
    host.setAttribute('popover', 'manual')
    document.body.appendChild(host)
    render(h(UiToastHost, { items: state.items }), host)
  }
  // 顶层元素按打开先后叠放：每次重新打开，保证在之后弹出的对话框上面
  if (typeof host.showPopover !== 'function') return
  if (host.matches(':popover-open')) host.hidePopover()
  host.showPopover()
}

function clearTimer(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
}

function schedule(id: number, duration: number): void {
  clearTimer(id)
  if (duration > 0)
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration)
    )
}

function dismiss(id: number): void {
  clearTimer(id)
  const index = state.items.findIndex(item => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
}

function show(
  kind: ToastKind,
  text: string,
  options?: ToastOptions
): ToastDismiss {
  const duration = options?.duration ?? TOAST_DURATION[kind]
  const same = state.items.find(
    item => item.kind === kind && item.text === text
  )
  if (same) {
    schedule(same.id, duration)
    return () => dismiss(same.id)
  }
  const id = nextId++
  state.items.push({ id, kind, text })
  while (state.items.length > MAX_TOASTS) dismiss(state.items[0].id)
  schedule(id, duration)
  ensureHost()
  return () => dismiss(id)
}

/** 命令式轻提示，见文件头说明 */
export const toast = {
  success: (text: string, options?: ToastOptions): ToastDismiss =>
    show('success', text, options),
  error: (text: string, options?: ToastOptions): ToastDismiss =>
    show('error', text, options),
  warning: (text: string, options?: ToastOptions): ToastDismiss =>
    show('warning', text, options),
  info: (text: string, options?: ToastOptions): ToastDismiss =>
    show('info', text, options),
  /** 进行中的提示，不会自动消失；用返回的函数收起 */
  loading: (text: string): ToastDismiss =>
    show('loading', text, { duration: 0 }),
  /** 收起全部提示 */
  clear(): void {
    for (const item of [...state.items]) dismiss(item.id)
  },
}
