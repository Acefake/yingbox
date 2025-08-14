/**
 * 节流函数
 * @param fn 需要节流的函数
 * @param delay 延迟时间(ms)
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let lastTime = 0
  let timer: NodeJS.Timeout | null = null

  return function (...args: Parameters<T>) {
    const now = Date.now()

    // 清除之前的定时器
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    // 如果距离上次执行超过延迟时间，立即执行
    if (now - lastTime >= delay) {
      fn.apply(this, args)
      lastTime = now
    } else {
      // 否则设置定时器，延迟执行
      timer = setTimeout(() => {
        fn.apply(this, args)
        lastTime = Date.now()
      }, delay)
    }
  }
}
