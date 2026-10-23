/**
 * 播放弹窗的状态：全应用同一时间只播一个。桌面与网页、所有入口都经 openMediaPlayer 打开这里。
 *
 * - 打开：盖在当前页面上播放，页面状态不变；正在播（含缩在小窗里）时换成新的会话；
 * - 缩小：会话交给角落小窗（DOM 搬移由 PlayerModal 做），弹窗隐藏；
 * - 关闭：清空，播放会话卸载时保存进度、拆除播放器。
 */
import { type ShallowRef, shallowRef } from 'vue'

import type { PlayerPayload } from '../utils/play-queue'

/** 一次播放弹窗会话 */
export interface PlayerModalState {
  /** 会话序号：每次打开都换新，播放会话按它重建；也是小窗认领用的 key */
  id: number
  payload: PlayerPayload
  /** 缩在角落小窗里 */
  minimized: boolean
}

const state = shallowRef<PlayerModalState | null>(null)
let opened = 0

/** 当前会话（响应式，只读）；没在播时为 null。 */
export function playerModal(): Readonly<ShallowRef<PlayerModalState | null>> {
  return state
}

/** 打开播放弹窗；正在播时换成新的会话（同一载荷再次打开也重新开始）。 */
export function openPlayerModal(payload: PlayerPayload): void {
  state.value = { id: ++opened, payload: { ...payload }, minimized: false }
}

/** 标记缩小 / 展开（只改状态，DOM 搬移在 PlayerModal） */
export function setPlayerModalMinimized(minimized: boolean): void {
  const current = state.value
  if (current && current.minimized !== minimized)
    state.value = { ...current, minimized }
}

/** 关闭播放弹窗。 */
export function closePlayerModal(): void {
  state.value = null
}
