/**
 * 事件去抖合批：静默 quietMs 后整批交出；持续有事件时最长每 maxWaitMs 交一次，避免饿死。
 * 用于把文件监听的连串事件（拷贝一季剧集会产生上百个事件）合成一次增量扫描。
 */

/** 合批参数。 */
export interface BatcherOptions {
  /** 最后一个事件之后静默多久交出，默认 1000 ms。 */
  quietMs?: number
  /** 第一个事件之后最长多久必须交出，默认 10000 ms。 */
  maxWaitMs?: number
}

/** 按键去重的合批器。 */
export class KeyedBatcher<T> {
  private pending = new Map<string, T>()
  private quietTimer: ReturnType<typeof setTimeout> | undefined
  private maxTimer: ReturnType<typeof setTimeout> | undefined
  private readonly quietMs: number
  private readonly maxWaitMs: number

  constructor(
    private readonly onFlush: (items: T[]) => void,
    options: BatcherOptions = {}
  ) {
    this.quietMs = options.quietMs ?? 1000
    this.maxWaitMs = options.maxWaitMs ?? 10_000
  }

  /** 加入一项；同键的项只保留最新一个。 */
  push(key: string, item: T): void {
    this.pending.set(key, item)
    clearTimeout(this.quietTimer)
    this.quietTimer = setTimeout(() => this.flush(), this.quietMs)
    this.maxTimer ??= setTimeout(() => this.flush(), this.maxWaitMs)
  }

  /** 立即交出当前批（没有待交项时什么都不做）。 */
  flush(): void {
    clearTimeout(this.quietTimer)
    clearTimeout(this.maxTimer)
    this.quietTimer = this.maxTimer = undefined
    if (!this.pending.size) return
    const items = [...this.pending.values()]
    this.pending = new Map()
    this.onFlush(items)
  }

  /** 丢弃待交项并停止计时。 */
  dispose(): void {
    clearTimeout(this.quietTimer)
    clearTimeout(this.maxTimer)
    this.quietTimer = this.maxTimer = undefined
    this.pending.clear()
  }
}
