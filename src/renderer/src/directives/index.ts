import { App } from 'vue'
import vContextMenu from '@/directives/context-menu'
import { vScrollX } from '@/directives/scroll-x'
import { vTooltip } from '@/components/ui/tooltip'

// 所有自定义指令
const directives = {
  contextMenu: vContextMenu,
  scrollX: vScrollX,
  tooltip: vTooltip,
}

// 批量注册指令的函数
export function setupDirectives(app: App): void {
  app.directive('contextMenu', vContextMenu)
  app.directive('scrollX', vScrollX)
  app.directive('tooltip', vTooltip)
}

// 单独导出指令
export { vContextMenu }

// 默认导出
export default directives
