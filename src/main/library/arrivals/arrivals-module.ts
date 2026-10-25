/**
 * 新入库：看片库自己的事件（扫描后的 items-changed、识别结束的 identify-progress），去抖后扫一轮
 * 水位之后的新电影 / 新集，把可以宣布的交给宿主（桌面端推送通知）和自动字幕。
 *
 * 只读数据库、只往外交结果，不排任何片库任务，所以挂在事件上而不是任务后继里：扫描 / 识别的任务链不受影响。
 * 一轮是幂等的（游标见 arrival-rules.ts），引擎重启后漏掉的事件由下一次事件或启动时的一轮补上。
 */
import type { LibraryArrival } from '../../../shared/library/arrivals'
import type { LibraryEvent } from '../../../shared/library/ipc'
import type { LibraryDb } from '../db/database'
import { planArrivals } from './arrival-rules'
import {
  ARRIVAL_BATCH,
  type ArrivalCandidate,
  ArrivalStore,
} from './arrival-store'

/** 事件后等多久再扫（一次扫描会连发好几批 items-changed）。 */
export const ARRIVAL_QUIET_MS = 5_000

/** 依赖。 */
export interface ArrivalsDeps {
  db: LibraryDb
  /** 订阅片库事件，返回取消订阅。 */
  subscribe: (listener: (event: LibraryEvent) => void) => () => void
  /** 库开没开自动识别；库已删除按没开处理。 */
  autoIdentify: (libraryId: number) => boolean
  /** 宣布一批新入库（按入库时间排好）。 */
  deliver: (arrivals: LibraryArrival[]) => void
  now?: () => number
  log?: (message: string) => void
}

/** 只保留交给宿主的字段。 */
function toArrival(row: ArrivalCandidate): LibraryArrival {
  const { identifiedAt: _, ...arrival } = row
  return arrival
}

/** 新入库模块。 */
export class ArrivalsModule {
  private readonly store: ArrivalStore
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | undefined
  private recheck: ReturnType<typeof setTimeout> | undefined
  private unsubscribe: (() => void) | undefined

  constructor(private readonly deps: ArrivalsDeps) {
    this.store = new ArrivalStore(deps.db)
    this.now = deps.now ?? Date.now
  }

  /** 开始看事件，并补扫一轮（停机期间入库、还没宣布的）；第一次运行时就地定下水位。 */
  start(): void {
    this.store.cursor(this.now())
    this.unsubscribe ??= this.deps.subscribe(event => {
      if (
        (event.type === 'items-changed' &&
          (event.added.length || event.updated.length || event.reset)) ||
        (event.type === 'identify-progress' && event.finished)
      )
        this.schedule(ARRIVAL_QUIET_MS)
    })
    this.schedule(ARRIVAL_QUIET_MS)
  }

  close(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    clearTimeout(this.timer)
    clearTimeout(this.recheck)
  }

  /** 扫一轮，返回这一轮宣布的条目（测试直接调用）。 */
  sweep(): LibraryArrival[] {
    const out: LibraryArrival[] = []
    const now = this.now()
    for (;;) {
      const cursor = this.store.cursor(now)
      const rows = this.store.candidates(cursor.since)
      const plan = planArrivals(rows, cursor, now, this.deps.autoIdentify)
      this.store.saveCursor(plan.cursor, now)
      out.push(...plan.ready.map(toArrival))
      clearTimeout(this.recheck)
      if (plan.recheckAt !== null) {
        this.recheck = setTimeout(
          () => this.schedule(0),
          Math.max(1000, plan.recheckAt - now)
        )
        this.recheck.unref?.()
      }
      // 这一批没取完（一次入库很多）并且水位往前走了：接着取
      if (rows.length < ARRIVAL_BATCH || plan.cursor.since === cursor.since)
        break
    }
    if (out.length) this.deps.deliver(out)
    return out
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      try {
        this.sweep()
      } catch (error) {
        this.deps.log?.(`新入库检查失败：${(error as Error).message}`)
      }
    }, delayMs)
    this.timer.unref?.()
  }
}
