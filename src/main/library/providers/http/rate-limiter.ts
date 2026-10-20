/**
 * 限流原语：令牌桶（每秒请求数）+ 并发信号量，以及可整体“暂停”的冷却（429 Retry-After）。
 *
 * 时钟与睡眠可注入：单测用虚拟时钟，不真的等待。
 */

/** 时钟：当前毫秒数与睡眠。 */
export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

/** 真实时钟。 */
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const timer = setTimeout(done, Math.max(0, ms))

      function done(): void {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }

      function onAbort(): void {
        clearTimeout(timer)
        reject(signal!.reason)
      }

      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}

/**
 * 令牌桶：容量 burst，每秒补 rate 个。acquire 按先来后到排队，
 * 保证长时间满负荷时的平均速率不超过 rate。
 * pauseUntil 让所有后续 acquire 等到指定时刻（服务端要求退避时全局生效）。
 */
export class TokenBucket {
  private tokens: number
  private last: number
  private pausedUntil = 0
  /** 排队链：每个 acquire 等前一个拿到令牌后再算自己的等待时间。 */
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly clock: Clock
  ) {
    this.tokens = burst
    this.last = clock.now()
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.last)
    this.tokens = Math.min(
      this.burst,
      this.tokens + (elapsed * this.rate) / 1000
    )
    this.last = now
  }

  /** 全局冷却到 until（毫秒时间戳）；多次调用取最晚的。 */
  pauseUntil(until: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, until)
  }

  /** 取一个令牌，必要时等待。 */
  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.tail.then(async () => {
      for (;;) {
        signal?.throwIfAborted()
        const now = this.clock.now()
        if (now < this.pausedUntil) {
          await this.clock.sleep(this.pausedUntil - now, signal)
          continue
        }
        this.refill(now)
        if (this.tokens >= 1) {
          this.tokens -= 1
          return
        }
        await this.clock.sleep(((1 - this.tokens) * 1000) / this.rate, signal)
      }
    })
    // 一个等待者被取消不能卡住后面的人
    this.tail = turn.catch(() => {})
    return turn
  }
}

/** 并发信号量。 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  /** 当前占用数（测试观察用）。 */
  get inUse(): number {
    return this.active
  }

  /** 占一个名额，返回释放函数。 */
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve))
    } else {
      this.active++
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      // 名额直接交给下一个等待者，active 不变
      if (next) next()
      else this.active--
    }
  }
}
