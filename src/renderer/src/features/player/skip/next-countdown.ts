/**
 * 「下一集」倒计时：每秒减一，到 0 触发一次完成；paused 为真的那一秒不走（片尾里暂停时停表）。
 * 片尾卡片与播完卡片共用（use-skip-segments）。
 */

/** createCountdown 的输入 */
export interface CountdownOptions {
  /** 剩余秒数变化（开始时也报一次） */
  onTick: (remaining: number) => void
  /** 到 0：只触发一次 */
  onDone: () => void
  /** 这一秒是否停表 */
  paused?: () => boolean
}

/** 一个倒计时 */
export interface Countdown {
  /** 从 seconds 开始（正在走的会重新开始） */
  start: (seconds: number) => void
  /** 停下，不触发完成 */
  stop: () => void
  running: () => boolean
}

export function createCountdown(options: CountdownOptions): Countdown {
  let timer: ReturnType<typeof setInterval> | undefined
  let remaining = 0
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  return {
    start(seconds) {
      stop()
      remaining = seconds
      options.onTick(remaining)
      timer = setInterval(() => {
        if (options.paused?.()) return
        remaining -= 1
        options.onTick(remaining)
        if (remaining > 0) return
        stop()
        options.onDone()
      }, 1000)
    },
    stop,
    running: () => timer !== undefined,
  }
}
