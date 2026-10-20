import type { Api } from '../../../shared/contract'
import type { LibraryBridge } from '../../../shared/library/ipc'

declare global {
  interface Window {
    /** 主进程能力，由 preload 按 IPC 契约生成；Web / PWA 模式下不存在 */
    api: Api & {
      /** 媒体库引擎（影视项目维护）：增删媒体库、扫描、分页查询、条目详情、事件订阅。 */
      library: LibraryBridge
    }
  }
}

export {}
