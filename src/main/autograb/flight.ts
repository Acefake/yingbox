/**
 * 追更三个服务（剧集、电影追踪、洗版）共用的并发规则（纯逻辑，不依赖 Electron）：
 *
 * - {@link createRoundRunner}：定时一轮不并发两轮；跑的途中又被叫（重试、新加追踪、立即运行），
 *   这一轮跑完马上补跑一轮，新改的记录不用等下一个 30 分钟；途中多次请求合成一次补跑，force 取并集；
 * - {@link createSingleFlight}：同一条记录的转存同一时间只发一次，连点、手动与全自动撞在一起时共用同一个结果，
 *   不会对 115 发两次转存、也不会多占每日转存限额。
 */

/** 一轮的执行器 */
export interface RoundRunner {
  /**
   * 跑一轮；已在跑时记下补跑，返回值在补跑那一轮结束时才完成。
   * @param force 传给这一轮（补跑时取途中所有请求的并集）
   */
  run(force?: boolean): Promise<void>
}

/**
 * 建一轮的执行器。
 * @param once 真正跑一轮；抛错由调用方自己记日志（这里只保证不挂住后续的轮）
 */
export function createRoundRunner(
  once: (force: boolean) => Promise<void>
): RoundRunner {
  let current: Promise<void> | null = null
  /** 跑的途中收到的补跑请求：null = 没有 */
  let again: { force: boolean } | null = null

  const start = (force: boolean): Promise<void> => {
    const task: Promise<void> = (async () => {
      let next: boolean | null = force
      while (next !== null) {
        const round = next
        again = null
        await once(round).catch(() => {})
        next = again ? (again as { force: boolean }).force : null
      }
    })().finally(() => {
      if (current === task) current = null
    })
    return task
  }

  return {
    run(force = false) {
      if (current) {
        again = { force: force || (again?.force ?? false) }
        return current
      }
      current = start(force)
      return current
    },
  }
}

/** 按键的单飞：同一个键进行中的任务共用一次 */
export interface SingleFlight {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

/** 建按键的单飞 */
export function createSingleFlight(): SingleFlight {
  const inflight = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const running = inflight.get(key)
      if (running) return running as Promise<T>
      const started = task().finally(() => inflight.delete(key))
      inflight.set(key, started)
      return started
    },
  }
}
