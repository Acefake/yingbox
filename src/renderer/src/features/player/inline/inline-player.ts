/**
 * 应用内播放器的状态：同一时间只播一个，打开即盖住整个主窗口，关闭回到原来的页面。
 * 内置播放器不再开独立窗口；mpv 仍是独立进程（见 use-media-player）。
 */
import { type ShallowRef, shallowRef } from 'vue'

import type { PlayerPayload } from '../utils/play-queue'

const current = shallowRef<PlayerPayload | null>(null)

/** 正在播放的载荷（响应式）；没在播时为 null。 */
export function inlinePlayback(): Readonly<ShallowRef<PlayerPayload | null>> {
  return current
}

/** 打开应用内播放器；正在播时换成新的载荷（播放会话随之重新开始）。 */
export function openInlinePlayer(payload: PlayerPayload): void {
  current.value = { ...payload }
}

/** 关闭应用内播放器。 */
export function closeInlinePlayer(): void {
  current.value = null
}
