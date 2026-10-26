/**
 * 渲染层网盘调用封装：桌面端 window.api.pan115 / offline（IPC），网页端经独立片库服务（HTTP RPC，契约相同）。
 */
import type { Api } from '../../../../shared/contract'
import { serverDomain } from '@/services/server-domains'

const bridge =
  typeof window !== 'undefined'
    ? (window.api?.pan115 ?? serverDomain('pan115'))
    : undefined

const offlineBridge =
  typeof window !== 'undefined'
    ? (window.api?.offline ?? serverDomain('offline'))
    : undefined

/** 当前平台能否用网盘（桌面端，或连着片库服务的网页端） */
export const netdiskAvailable = Boolean(bridge)

/** pan115 域；没有桥时调用抛错 */
export function netdisk(): Api['pan115'] {
  if (!bridge) throw new Error('网盘需要桌面端或片库服务')
  return bridge
}

/** offline 域（115 离线下载）；没有桥时调用抛错 */
export function offlineDownloads(): Api['offline'] {
  if (!offlineBridge) throw new Error('离线下载需要桌面端或片库服务')
  return offlineBridge
}

/** 打开设置 · 网盘 */
export function openNetdiskSettings(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'netdisk' })
  )
}
