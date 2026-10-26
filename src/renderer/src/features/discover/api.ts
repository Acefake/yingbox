/**
 * 渲染层库外发现调用封装：桌面端 window.api.discover（IPC），网页端经独立片库服务（HTTP RPC，契约相同）。
 */
import type { Api } from '../../../../shared/contract'
import { serverDomain } from '@/services/server-domains'

const bridge =
  typeof window !== 'undefined'
    ? (window.api?.discover ?? serverDomain('discover'))
    : undefined

/** 当前平台能否用库外发现（桌面端，或连着片库服务的网页端） */
export const discoverAvailable = Boolean(bridge)

/** discover 域；没有桥时调用抛错 */
export function discoverApi(): Api['discover'] {
  if (!bridge) throw new Error('找 115 资源需要桌面端或片库服务')
  return bridge
}

/** 打开设置 · 网盘（PanSou 地址、115 登录、助手转存目标文件夹） */
export function openNetdiskSettings(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'netdisk' })
  )
}
