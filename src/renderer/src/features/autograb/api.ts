/**
 * 渲染层追更调用封装（window.api.autograb）。网页端没有主进程，autograbAvailable 为 false。
 */
import type { Api } from '../../../../shared/contract'

const bridge = typeof window !== 'undefined' ? window.api?.autograb : undefined

/** 当前平台能否用追更（桌面端） */
export const autograbAvailable = Boolean(bridge)

/** autograb 域；网页端调用时抛错 */
export function autograbApi(): Api['autograb'] {
  if (!bridge) throw new Error('追更需要桌面端')
  return bridge
}
