/**
 * 渲染层洗版 / 电影上线追踪调用封装：桌面端 window.api.autograbUpgrade / autograbMovies（IPC），
 * 网页端经独立片库服务（HTTP RPC + SSE，契约相同）。
 */
import type { Api } from '../../../../shared/contract'
import { serverDomain } from '@/services/server-domains'

const upgradeBridge =
  typeof window !== 'undefined'
    ? (window.api?.autograbUpgrade ?? serverDomain('autograbUpgrade'))
    : undefined
const moviesBridge =
  typeof window !== 'undefined'
    ? (window.api?.autograbMovies ?? serverDomain('autograbMovies'))
    : undefined

/** 当前平台能否用洗版 / 电影追踪（桌面端，或连着片库服务的网页端） */
export const autograbUpgradeAvailable = Boolean(upgradeBridge && moviesBridge)

/** autograbUpgrade 域；没有桥时调用抛错 */
export function upgradeApi(): Api['autograbUpgrade'] {
  if (!upgradeBridge) throw new Error('洗版需要桌面端或片库服务')
  return upgradeBridge
}

/** autograbMovies 域；没有桥时调用抛错 */
export function moviesApi(): Api['autograbMovies'] {
  if (!moviesBridge) throw new Error('电影追踪需要桌面端或片库服务')
  return moviesBridge
}
