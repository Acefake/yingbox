/**
 * TMDB 令牌补发规则（两种宿主共用）：片库还没配置、宿主自己存的令牌有值时下发一次，不覆盖片库已有的令牌。
 * 桌面端的令牌在设置密钥（safeStorage，src/main/tmdb.ts），独立服务的在 secrets.json（src/server/secrets.ts）。
 */
import type { ProviderStatus } from '../../../shared/library/ipc'

/** 媒体库引擎里令牌的读写口（只依赖这两个方法，便于测试）。 */
export interface LibraryTokenTarget {
  getProviderStatus(): Promise<ProviderStatus>
  setProviderToken(token: string | null): Promise<unknown>
}

/**
 * 启动时：片库还没配置、宿主存的用户令牌有值时下发。返回是否下发了。
 * 没有令牌时不碰片库（桌面端引擎按需启动，不为这件事 fork）。
 */
export async function syncTmdbTokenToLibrary(
  library: LibraryTokenTarget,
  userToken: string
): Promise<boolean> {
  const token = userToken.trim()
  if (!token || (await library.getProviderStatus()).tmdb.configured)
    return false
  await library.setProviderToken(token)
  return true
}
