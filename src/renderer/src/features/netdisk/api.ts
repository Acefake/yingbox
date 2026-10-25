/**
 * 渲染层网盘调用封装（window.api.pan115）。网页端没有主进程，netdiskAvailable 为 false。
 */
import type { Api } from '../../../../shared/contract'

const bridge = typeof window !== 'undefined' ? window.api?.pan115 : undefined

/** 当前平台能否用网盘（桌面端） */
export const netdiskAvailable = Boolean(bridge)

/** pan115 域；网页端调用时抛错 */
export function netdisk(): Api['pan115'] {
  if (!bridge) throw new Error('网盘需要桌面端')
  return bridge
}

/** 打开设置 · 网盘 */
export function openNetdiskSettings(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'netdisk' })
  )
}
