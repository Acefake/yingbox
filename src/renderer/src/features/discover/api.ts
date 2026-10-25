/**
 * 渲染层库外发现调用封装（window.api.discover）。网页端没有主进程，discoverAvailable 为 false。
 */
import type { Api } from '../../../../shared/contract'

const bridge = typeof window !== 'undefined' ? window.api?.discover : undefined

/** 当前平台能否用库外发现（桌面端） */
export const discoverAvailable = Boolean(bridge)

/** discover 域；网页端调用时抛错 */
export function discoverApi(): Api['discover'] {
  if (!bridge) throw new Error('找 115 资源需要桌面端')
  return bridge
}

/** 打开设置 · 网盘（PanSou 地址、115 登录、助手转存目标文件夹） */
export function openNetdiskSettings(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'netdisk' })
  )
}
