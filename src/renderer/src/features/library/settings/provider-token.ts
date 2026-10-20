/**
 * TMDB 令牌：媒体库识别在引擎进程里进行，令牌存在引擎（setProviderToken / getProviderStatus）。
 *
 * 旧版本把令牌存在 localStorage（scrapeProviderConfig.tmdbAccessToken，在线页面仍从那里读）。
 * 启动时做一次性迁移：引擎还没配置、本地有旧值，就下发给引擎，并记下已迁移，之后不再覆盖引擎。
 */
import type {
  LibraryBridge,
  ProviderStatus,
} from '../../../../../shared/library/ipc'
import {
  getTmdbAccessToken,
  saveScrapeProviderConfig,
} from '@/stores/scrape-provider-store'

/** 记录“已迁移”的 localStorage 键。 */
export const TOKEN_MIGRATED_KEY = 'library.tmdbTokenMigrated'

/**
 * 一次性把旧令牌迁到引擎。返回是否下发了令牌。
 * 引擎不可用（网页版）时什么也不做，也不记已迁移，等桌面版启动时再迁。
 */
export async function migrateLegacyTmdbToken(
  bridge: Pick<LibraryBridge, 'getProviderStatus' | 'setProviderToken'> | null,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  legacyToken: () => string = getTmdbAccessToken
): Promise<boolean> {
  if (!bridge || storage.getItem(TOKEN_MIGRATED_KEY) === '1') return false
  try {
    const status = await bridge.getProviderStatus()
    const token = legacyToken().trim()
    let pushed = false
    if (!status.tmdb.configured && token) {
      await bridge.setProviderToken('tmdb', token)
      pushed = true
    }
    storage.setItem(TOKEN_MIGRATED_KEY, '1')
    return pushed
  } catch (error) {
    console.warn('迁移 TMDB 令牌到媒体库引擎失败', (error as Error).message)
    return false
  }
}

/**
 * 在媒体库设置里修改令牌：写进引擎；同时写回 localStorage，让在线页面（豆瓣 / 详情的 TMDB 补充）
 * 用同一个令牌。saveScrapeProviderConfig 会再同步一次引擎，内容相同，无副作用。
 */
export async function setTmdbToken(
  bridge: Pick<LibraryBridge, 'setProviderToken'>,
  token: string
): Promise<ProviderStatus> {
  const value = token.trim()
  const status = await bridge.setProviderToken('tmdb', value || null)
  saveScrapeProviderConfig({ tmdbAccessToken: value })
  return status
}
