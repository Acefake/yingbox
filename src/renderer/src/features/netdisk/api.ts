/**
 * 渲染层网盘调用封装：桌面端 window.api.pan115 / offline（IPC），网页端经独立片库服务（HTTP RPC，契约相同）。
 */
import { ref } from 'vue'
import type { Api } from '../../../../shared/contract'
import type { Pan115Account } from '../../../../shared/contract/pan115'
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

/**
 * 全局 115 账号。null 表示还没成功查过。
 * 外壳挂载时查一次，设置里登录 / 退出和登录页成功后写入同一份，侧栏跟着变。
 */
export const netdiskAccount = ref<Pan115Account | null>(null)

/** 是否已经成功读到过账号，或明确知道当前平台不能登录。读失败保持 false，下次再查。 */
export const netdiskAccountKnown = ref(false)

/** 还没确认过账号，并且最近一次读取失败。侧栏这时仍留「登录网盘」，方便打开重试页。 */
export const netdiskAccountFailed = ref(false)

/** 登录、退出等已经拿到确定结果时写入，并记为已确认。 */
export function setNetdiskAccount(account: Pan115Account): void {
  netdiskAccount.value = account
  netdiskAccountKnown.value = true
  netdiskAccountFailed.value = false
}

/**
 * 读取 115 账号。
 * 失败时保留上一次的确认结果；还没成功过就继续是未确认，下次再查。
 */
export async function refreshNetdiskAccount(): Promise<void> {
  if (!bridge) {
    setNetdiskAccount({ loggedIn: false })
    return
  }
  try {
    setNetdiskAccount(await bridge.account())
  } catch {
    if (!netdiskAccountKnown.value) netdiskAccountFailed.value = true
  }
}

/** 还没成功读到账号时先查一次。路由守卫用它决定能不能进追剧日历和自动追更。 */
export async function ensureNetdiskAccount(): Promise<void> {
  if (!netdiskAccountKnown.value) await refreshNetdiskAccount()
}

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
