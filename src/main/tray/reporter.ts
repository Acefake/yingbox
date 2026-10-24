/**
 * 上报播放状态的渲染页面的生命周期：页面一旦失效（窗口关闭、渲染进程崩溃、主框架重载 / 跳页），
 * 它上报的播放状态就作废，托盘要清空、媒体键要释放。
 *
 * 渲染进程崩溃或刷新时 WebContents 仍然存在，不会触发 destroyed，Vue 的卸载钩子也不保证执行，
 * 所以除了 destroyed 还要监听 render-process-gone 与主框架的跨文档导航。
 */

/** 只需要 WebContents 的事件订阅能力（测试里可用 EventEmitter 代替） */
export interface ReporterEmitter {
  on(event: string, listener: (...args: never[]) => void): unknown
  off(event: string, listener: (...args: never[]) => void): unknown
}

/** did-start-navigation 的导航详情里本模块用到的字段 */
export interface NavigationDetails {
  isMainFrame?: boolean
  isSameDocument?: boolean
}

/**
 * 导航是否让当前页面会话失效：主框架、且不是同文档导航（hash / pushState 不算）。
 * 重载与跳到别的页面都算。
 */
export function resetsSession(details: NavigationDetails | undefined): boolean {
  return Boolean(details?.isMainFrame) && !details?.isSameDocument
}

/**
 * 监听上报方页面失效，失效时调用一次 onGone。
 *
 * @returns 取消监听（换了上报方时调用）
 */
export function watchReporter(
  sender: ReporterEmitter,
  onGone: () => void
): () => void {
  let active = true
  const gone = (): void => {
    if (!active) return
    stop()
    onGone()
  }
  const onNavigate = (details?: NavigationDetails): void => {
    if (resetsSession(details)) gone()
  }
  const stop = (): void => {
    active = false
    sender.off('destroyed', gone)
    sender.off('render-process-gone', gone)
    sender.off('did-start-navigation', onNavigate)
  }
  sender.on('destroyed', gone)
  sender.on('render-process-gone', gone)
  sender.on('did-start-navigation', onNavigate)
  return stop
}
