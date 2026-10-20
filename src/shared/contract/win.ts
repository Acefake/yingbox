import { call, defineDomain } from './define'

/** 无边框窗口的窗口控制，作用于发起调用的那个窗口。 */
export const win = defineDomain('win', {
  /** 最小化 */
  minimize: call<void>(),
  /** 最大化 / 还原 */
  maximize: call<void>(),
  /** 关闭 */
  close: call<void>(),
  /** 是否已最大化 */
  isMaximized: call<boolean>(),
})
