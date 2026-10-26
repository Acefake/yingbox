/**
 * 渲染层追更调用封装：桌面端 window.api.autograb（IPC），网页端经独立片库服务（HTTP RPC + SSE，契约相同）。
 */
import type { Api } from '../../../../shared/contract'
import { serverDomain } from '@/services/server-domains'

const bridge =
  typeof window !== 'undefined'
    ? (window.api?.autograb ?? serverDomain('autograb'))
    : undefined

/** 当前平台能否用追更（桌面端，或连着片库服务的网页端） */
export const autograbAvailable = Boolean(bridge)

/** autograb 域；没有桥时调用抛错 */
export function autograbApi(): Api['autograb'] {
  if (!bridge) throw new Error('追更需要桌面端或片库服务')
  return bridge
}
