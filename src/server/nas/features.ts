/** NAS 保留完整服务能力，并兼容已有元数据接口。 */
import type { DomainRegistry } from '../domains/registry'
import {
  type ServerFeatureDeps,
  registerServerFeatures as registerFullFeatures,
} from '../features'
import type { Router } from '../http/router'
import { registerNasMetadata } from './metadata'
import type { NetClient } from '../../shared/net/client'

export function registerServerFeatures(
  router: Router,
  registry: DomainRegistry,
  deps: ServerFeatureDeps & { net?: NetClient }
): { close(): Promise<void> } {
  registerNasMetadata(router, deps)
  return registerFullFeatures(router, registry, deps)
}
