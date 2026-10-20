import { App } from 'vue'
import vContextMenu from '@/directives/context-menu'
import { vScrollX } from '@/directives/scroll-x'
import { vTooltip } from '@/components/ui/tooltip'

// 批量注册指令的函数
export function setupDirectives(app: App): void {
  app.directive('contextMenu', vContextMenu)
  app.directive('scrollX', vScrollX)
  app.directive('tooltip', vTooltip)
}
