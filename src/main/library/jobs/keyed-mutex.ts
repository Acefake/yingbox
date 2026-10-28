/**
 * 按键互斥：同一个键上的异步临界区排队执行，不同键互不影响。
 *
 * 用于“同一媒体库的扫描与整理不能交错”：整理会改 files 表里的路径，扫描若拿着旧快照
 * 同时写回，会把刚移动的文件当成“删除 + 新增”，丢掉它的匹配。任务队列的 key 互斥只管同 key，
 * 而扫描与整理的 key 不同（各自要合并排队载荷），所以另用这把锁。
 */
export class KeyedMutex<K> {
  private readonly tails = new Map<K, Promise<void>>()

  /** 在键 key 的锁内执行 fn。 */
  async run<T>(key: K, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => (release = resolve))
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    try {
      signal?.throwIfAborted()
      if (signal) {
        let onAbort: (() => void) | undefined
        try {
          await Promise.race([
            previous,
            new Promise<never>((_, reject) => {
              onAbort = () => reject(signal.reason)
              signal.addEventListener('abort', onAbort, { once: true })
              if (signal.aborted) onAbort()
            }),
          ])
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort)
        }
      } else {
        await previous
      }
      signal?.throwIfAborted()
      return await fn()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
