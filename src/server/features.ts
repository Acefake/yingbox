/** 完整片库服务的可选模块；NAS 构建使用 nas/features.ts。 */
import type { Router } from './http/router'
import type { DomainRegistry } from './domains/registry'
import { registerServerIptv } from './iptv'
import { type OnlineDeps, registerOnline } from './online'
import { loadOnlineConfig } from './online/config'
import { registerStreamRoute } from './online/stream/route'
import { type ViewRecords, registerView } from './view'

/** 没接播放记录时（测试注入的组装）：都为空，收藏写不进去 */
const NO_RECORDS: ViewRecords = {
  continueList: () => [],
  favorites: () => [],
  toggleFavorite: () => false,
  blockedSites: () => [],
  setSiteBlocked: () => [],
  sourceHealth: () => ({}),
  saveSourceHealth: () => {},
}

/** 共享服务组装提供的依赖，元数据语言和令牌保持服务端读取。 */
export type ServerFeatureDeps = OnlineDeps & {
  /** 服务端播放记录（ADR-0031），视图域读继续观看与收藏 */
  records?: ViewRecords
}

/** 登记完整服务的在线引擎、直播、流代理与视图域（ADR-0030），返回资源关闭句柄。 */
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
  const online = registerOnline(router, deps)
  if (online.engine)
    registerView(
      registry,
      online.engine,
      deps.records ?? NO_RECORDS,
      deps.networkPreferences
    )
  return { close: online.close }
}
