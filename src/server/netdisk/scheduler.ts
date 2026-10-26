/**
 * 服务端的定时器：模块宿主的 schedule() 落在这里。
 *
 * - 进程内单例：同名任务只登记一次，重复登记忽略并记一条日志；
 * - 跨实例单例：每轮执行前要持有调度租约（lease.ts），拿不到就跳过这一轮，下一轮再抢；
 *   持有期间每 ttl/3 续租，失去租约后下一轮自动停下；
 * - enabled 为 false（YINGBOX_AUTOGRAB=off）时只登记不执行，也不抢租约，留给别的实例跑；
 * - close() 清掉全部定时器并放手租约。
 */
import type { ScheduledTask } from '../../main/module-host'
import type { SchedulerLease } from './lease'

/** 选项 */
export interface SchedulerOptions {
  lease: SchedulerLease
  /** 本实例是否执行定时任务 */
  enabled: boolean
  log(message: string): void
}

/** 服务端定时器 */
export interface LeasedScheduler {
  schedule(task: ScheduledTask): void
  /** 已登记的任务名 */
  names(): string[]
  close(): void
}

/** 建服务端定时器 */
export function createLeasedScheduler(
  options: SchedulerOptions
): LeasedScheduler {
  const { lease, log } = options
  const tasks = new Set<string>()
  const timers: Array<ReturnType<typeof setTimeout>> = []
  let renewer: ReturnType<typeof setInterval> | null = null
  let warned = false

  /** 本轮能不能跑：持有租约，或者现在抢到了 */
  function leader(): boolean {
    if (lease.held && lease.renew()) return true
    if (lease.tryAcquire()) {
      warned = false
      log('取得调度租约，本实例负责追更定时任务')
      renewer ??= setInterval(
        () => {
          if (lease.held && !lease.renew()) log('调度租约已被其他实例接管')
        },
        Math.max(1000, Math.floor(lease.ttlMs / 3))
      )
      renewer.unref?.()
      return true
    }
    if (!warned) {
      warned = true
      log('调度租约在别的实例手里（同一数据目录），本实例不跑追更定时任务')
    }
    return false
  }

  function guarded(task: ScheduledTask): () => void {
    return () => {
      if (!leader()) return
      try {
        task.run()
      } catch (error) {
        log(`${task.name} 本轮出错：${(error as Error).message}`)
      }
    }
  }

  return {
    schedule(task) {
      if (tasks.has(task.name)) {
        log(`定时任务 ${task.name} 已登记，忽略重复登记`)
        return
      }
      tasks.add(task.name)
      if (!options.enabled) return
      const run = guarded(task)
      const first = setTimeout(() => {
        run()
        const every = setInterval(run, task.intervalMs)
        every.unref?.()
        timers.push(every)
      }, task.firstDelayMs)
      first.unref?.()
      timers.push(first)
    },
    names: () => [...tasks],
    close() {
      for (const timer of timers.splice(0)) clearTimeout(timer)
      if (renewer) clearInterval(renewer)
      renewer = null
      lease.release()
    },
  }
}
