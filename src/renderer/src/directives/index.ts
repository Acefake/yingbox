import { App } from 'vue'
import { vRightClick } from '@/directives/right-click'
import vContextMenu from '@/directives/context-menu'
import { vScrollX } from '@/directives/scroll-x'

// 所有自定义指令
const directives = {
  rightClick: vRightClick,
  contextMenu: vContextMenu,
  scrollX: vScrollX,
}

// 批量注册指令的函数
export function setupDirectives(app: App): void {
  Object.keys(directives).forEach(key => {
    app.directive(key, directives[key as keyof typeof directives])
  })
}

// 单独导出指令
export { vRightClick, vContextMenu }

// 默认导出
export default directives
