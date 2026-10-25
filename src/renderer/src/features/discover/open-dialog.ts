/**
 * 命令式打开「找 115 资源」弹窗（首页豆瓣卡用）：渲染到 body，关闭时卸载。同一时间只开一个。
 */
import { h, render } from 'vue'

import type { DiscoverTitle } from './discover-rules'

let close: (() => void) | null = null

/** 打开候选面板弹窗（条目先拷成普通对象，不把响应式对象带进去） */
export async function openDiscoverDialog(target: DiscoverTitle): Promise<void> {
  close?.()
  const { default: DiscoverDialog } =
    await import('./components/DiscoverDialog.vue')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const done = (): void => {
    if (close !== done) return
    close = null
    render(null, container)
    container.remove()
  }
  close = done
  render(h(DiscoverDialog, { target: { ...target }, onClose: done }), container)
}
