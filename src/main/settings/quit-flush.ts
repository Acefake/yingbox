/**
 * 退出前等设置落盘：settings.json 的写入是异步排队的（store.persist），而退出过程中还会写设置
 * （播放器窗口关窗时记 player.windowBounds）。will-quit 之后进程就结束了，排队中的写入会丢。
 *
 * 第一次 will-quit 拦住退出，等写入完成（最多 timeoutMs）后再调一次 app.quit()，让
 * before-quit → will-quit → quit 完整再走一轮：
 * - electron-updater 的「退出时安装」（autoInstallOnAppQuit）挂在 app 的 quit 事件上，exitCode 为 0 才装，
 *   所以收尾必须走 app.quit()，不能用 app.exit()（exit 不发 quit，下载好的更新会静默不装）；
 * - 第二轮里本监听直接放行；其他 before-quit / will-quit 监听会再跑一遍，它们都可重复调用
 *   （插件宿主第二轮放行，快捷键注销、引擎 / 片库宿主 stop、推送服务 / WebDAV 代理关闭、115 Cookie 清理重复调用无副作用）。
 *   新增 will-quit 监听也要保证可重复调用。
 * - 写入期间再次触发的退出同样拦住，等这一轮结束统一放行。
 */

/** 退出前最多等多久 */
export const QUIT_FLUSH_TIMEOUT_MS = 3000

/** holdQuitForFlush 需要的最小 app 接口（便于测试注入） */
export interface WillQuitSource {
  on(
    event: 'will-quit',
    listener: (event: { preventDefault(): void }) => void
  ): unknown
  quit(): void
}

/** 退出时等 flush 完成再继续退出；只应调用一次 */
export function holdQuitForFlush(
  app: WillQuitSource,
  flush: () => Promise<void>,
  timeoutMs: number = QUIT_FLUSH_TIMEOUT_MS
): void {
  let phase: 'idle' | 'flushing' | 'done' = 'idle'
  app.on('will-quit', event => {
    if (phase === 'done') return
    event.preventDefault()
    if (phase === 'flushing') return
    phase = 'flushing'
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(resolve, timeoutMs)
    })
    void Promise.race([flush().catch(() => {}), timeout]).then(() => {
      clearTimeout(timer)
      phase = 'done'
      app.quit()
    })
  })
}
