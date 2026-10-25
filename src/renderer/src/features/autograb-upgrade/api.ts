/**
 * 渲染层洗版 / 电影上线追踪调用封装（window.api.autograbUpgrade / autograbMovies）。
 * 网页端没有主进程，两个 available 都是 false。
 */
import type { Api } from '../../../../shared/contract'

const upgradeBridge =
  typeof window !== 'undefined' ? window.api?.autograbUpgrade : undefined
const moviesBridge =
  typeof window !== 'undefined' ? window.api?.autograbMovies : undefined

/** 当前平台能否用洗版 / 电影追踪（桌面端） */
export const autograbUpgradeAvailable = Boolean(upgradeBridge && moviesBridge)

/** autograbUpgrade 域；网页端调用时抛错 */
export function upgradeApi(): Api['autograbUpgrade'] {
  if (!upgradeBridge) throw new Error('洗版需要桌面端')
  return upgradeBridge
}

/** autograbMovies 域；网页端调用时抛错 */
export function moviesApi(): Api['autograbMovies'] {
  if (!moviesBridge) throw new Error('电影追踪需要桌面端')
  return moviesBridge
}
