/**
 * 单飞：同一个异步动作在上一次没结束前再次调用，直接拿到正在进行的那次结果，不会重跑。
 *
 * 用在切集上：下一集要异步解析地址时，「立即播放」、倒计时结束、旧视频自然结束
 * 可能在等待期间接连触发，只能真正切一次，否则会跳过一集。
 */

/** 单飞包装后的函数：调用即执行（或复用进行中的那次），pending() 说明是否在进行中 */
export interface SingleFlight<T> {
  (): Promise<T>
  /** 是否有一次调用尚未结束 */
  pending: () => boolean
}

/** 把异步动作包成单飞：进行中再调用返回同一个 Promise，结束（成功或失败）后才可再次执行 */
export function singleFlight<T>(run: () => Promise<T>): SingleFlight<T> {
  let current: Promise<T> | null = null
  const call = (): Promise<T> => {
    if (current) return current
    current = run().finally(() => {
      current = null
    })
    return current
  }
  return Object.assign(call, { pending: (): boolean => current !== null })
}
