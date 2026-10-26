/**
 * 退出前等设置落盘：settings.json 的写入是异步排队的（store.persist），而退出过程中还会写设置
 * （播放器窗口关窗时记 player.windowBounds）。will-quit 之后进程就结束了，排队中的写入会丢。
 *
 * 第一次 will-quit 拦住退出，等写入完成（最多 timeoutMs）后 app.exit()：其他 will-quit 监听在这一轮
 * 已经跑过，exit 不会再走一遍退出事件，清理逻辑不会重复执行。
 */

/** 退出前最多等多久 */
export const QUIT_FLUSH_TIMEOUT_MS = 3000

/** holdQuitForFlush 需要的最小 app 接口（便于测试注入） */
export interface WillQuitSource {
  on(
    event: 'will-quit',
    listener: (event: { preventDefault(): void }) => void
  ): unknown
  exit(code?: number): void
}

/** 退出时等 flush 完成再结束进程；只应调用一次 */
export function holdQuitForFlush(
  app: WillQuitSource,
  flush: () => Promise<void>,
  timeoutMs: number = QUIT_FLUSH_TIMEOUT_MS
): void {
  let held = false
  app.on('will-quit', event => {
    if (held) return
    held = true
    event.preventDefault()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(resolve, timeoutMs)
    })
    void Promise.race([flush().catch(() => {}), timeout]).then(() => {
      clearTimeout(timer)
      app.exit(0)
    })
  })
}
