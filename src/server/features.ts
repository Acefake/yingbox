/** 完整片库服务的可选模块；NAS 构建使用 nas/features.ts。 */
import type { Router } from './http/router'
import type { DomainRegistry } from './domains/registry'
import { registerServerIptv } from './iptv'
import { type OnlineDeps, registerOnline } from './online'
import { loadOnlineConfig } from './online/config'
import { registerStreamRoute } from './online/stream/route'

/** 共享服务组装提供的依赖，元数据语言和令牌保持服务端读取。 */
export type ServerFeatureDeps = OnlineDeps

/** 登记完整服务的在线引擎、直播和流代理，返回资源关闭句柄。 */
export function registerServerFeatures(
  router: Router,
  registry: DomainRegistry,
  deps: ServerFeatureDeps
): { close(): Promise<void> } {
  const config = loadOnlineConfig(deps.env, deps.dataDir)
  registerServerIptv(registry, {
    dataDir: deps.dataDir,
    allowPrivate: config.streamAllowPrivate,
  })
  if (!config.enabled)
    registerStreamRoute(router, { allowPrivate: config.streamAllowPrivate })
  return registerOnline(router, deps)
}
