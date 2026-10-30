/** NAS 只登记网盘所需的元数据请求，不启动在线播放引擎。 */
import type { DomainRegistry } from '../domains/registry'
import type { ServerFeatureDeps } from '../features'
import type { Router } from '../http/router'
import { registerNasMetadata } from './metadata'
import type { NetClient } from '../../shared/net/client'

/** 与完整服务使用相同组装契约，供 NAS 构建替换。 */
export function registerServerFeatures(
  router: Router,
  _registry: DomainRegistry,
  deps: ServerFeatureDeps & { net?: NetClient }
): { close(): Promise<void> } {
  registerNasMetadata(router, deps)
  deps.log('NAS 专用版：片库、网盘和元数据服务')
  return { close: async () => {} }
}
