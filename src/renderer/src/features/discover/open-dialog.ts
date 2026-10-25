/**
 * 命令式打开「找 115 资源」弹窗（首页豆瓣卡用）：渲染到 body，关闭时卸载。同一时间只开一个。
 *
 * 弹窗组件是异步加载的：连点两张卡时，只有最后一次打开会真正渲染，先发起的那次加载完发现已过时就放弃，
 * 不会留下关不掉的弹窗。
 */
import { type Component, h, render } from 'vue'

import type { DiscoverTitle } from './discover-rules'

/**
 * 用给定的组件加载器造一个「打开弹窗」函数（单测换成替身加载器）。
 * @param load 加载弹窗组件（接收 target 与 onClose）
 */
export function createDialogOpener(
  load: () => Promise<Component>
): (target: DiscoverTitle) => Promise<void> {
  /** 关掉当前弹窗 */
  let close: (() => void) | null = null
  /** 每次打开递增；加载完时与它比对，过时的打开直接放弃 */
  let opening = 0

  return async target => {
    const ticket = ++opening
    // 条目先拷成普通对象，不把响应式对象带进去
    const plain = { ...target }
    const component = await load()
    if (ticket !== opening) return
    close?.()
    const container = document.createElement('div')
    document.body.appendChild(container)
    let closed = false
    const done = (): void => {
      if (closed) return
      closed = true
      if (close === done) close = null
      render(null, container)
      container.remove()
    }
    close = done
    render(h(component, { target: plain, onClose: done }), container)
  }
}

/** 打开候选面板弹窗 */
export const openDiscoverDialog = createDialogOpener(
  async () => (await import('./components/DiscoverDialog.vue')).default
)
