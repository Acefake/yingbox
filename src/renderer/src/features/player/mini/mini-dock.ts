/**
 * 应用内小窗的交接台：全应用同一时刻最多一个小窗会话。
 *
 * 页内播放器离开详情时把「承载 <video> 的节点」整体交给这里（dockMini），节点被原样搬进小窗的挂载点，
 * 播放器实例（Artplayer / hls.js / 原生 <video>）不销毁、不重新请求，进度和缓冲都在；
 * 回到详情时播放器按同一个 key 认领回去（claimMini），再把节点搬回自己的容器。
 *
 * 搬移必须是一次同步的 appendChild：<video> 始终连在文档上，浏览器不会因为「移出文档」而暂停。
 * 拆除（teardown）只在显式关闭、换别的条目、设置关闭时发生，由会话的提供方实现。
 */
import { type ShallowRef, shallowRef } from 'vue'

import { getSetting } from '@/features/settings'

/** 小窗里的一个播放会话 */
export interface MiniSession {
  /** 播放源标识（通常是播放地址）：回来认领、判断「换了别的条目」都按它比 */
  key: string
  /** 小窗的无障碍名称 */
  title: string
  /** 整体搬移的节点（里面有 <video>） */
  node: HTMLElement
  /** 小窗的播放 / 暂停控制的就是它 */
  video: HTMLVideoElement
  /** 播放器自己的实例，认领方原样取回 */
  payload?: unknown
  /** 回到详情：导航回原处并重新显示播放层，之后由播放器认领 */
  restore: () => void
  /** 真正拆除播放器（销毁实例、通知宿主） */
  teardown: () => void
}

const session = shallowRef<MiniSession | null>(null)
let slot: HTMLElement | null = null
/** 进小窗前 <video> 的 controls，认领时还原 */
let savedControls = false

/** 当前小窗会话（响应式，只读） */
export function miniSession(): Readonly<ShallowRef<MiniSession | null>> {
  return session
}

/** 小窗组件挂载 / 卸载时登记自己的挂载点 */
export function setMiniSlot(el: HTMLElement | null): void {
  slot = el
}

/** 是否值得进小窗：正在播放（没暂停、没播完） */
export function canDock(
  video: Pick<HTMLVideoElement, 'paused' | 'ended'> | null | undefined
): boolean {
  return Boolean(video && !video.paused && !video.ended)
}

/**
 * 把会话交给小窗。设置关闭、没在播放、小窗没挂载时返回 false，调用方照常拆除或保留原样。
 * 小窗里已有别的会话时先拆掉它（同一时刻只播一个）。
 */
export function dockMini(next: MiniSession): boolean {
  if (!getSetting('ui.miniPlayer') || !slot || !canDock(next.video))
    return false
  if (session.value && session.value !== next) closeMini()
  savedControls = next.video.controls
  next.video.controls = false
  slot.appendChild(next.node)
  session.value = next
  return true
}

/** 认领同一 key 的会话：成功后小窗清空，调用方负责把 node 搬回自己的容器 */
export function claimMini(key: string): MiniSession | null {
  const current = session.value
  if (!current || current.key !== key) return null
  current.video.controls = savedControls
  session.value = null
  return current
}

/** 有播放器要开始播 key：小窗里是别的条目就拆掉 */
export function preemptMini(key: string): void {
  if (session.value && session.value.key !== key) closeMini()
}

/** 显式关闭小窗：拆除会话 */
export function closeMini(): void {
  const current = session.value
  if (!current) return
  session.value = null
  current.node.remove()
  current.teardown()
}

/** 回到详情：会话留在小窗里，直到播放器认领 */
export function returnFromMini(): void {
  session.value?.restore()
}
