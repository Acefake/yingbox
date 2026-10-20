/**
 * TMDB 令牌：媒体库识别在引擎进程里进行，引擎自己存一份（setProviderToken / getProviderStatus）；
 * 应用里的权威副本是设置密钥 `scrape.tmdbToken`（主进程 safeStorage，见 features/settings/tmdb-token）。
 *
 * 旧版本的明文令牌（localStorage 的 scrapeProviderConfig.tmdbAccessToken）由设置层首启迁移加密保存；
 * 启动时这里再把它补给还没配置的引擎。两边由 {@link saveLibraryTmdbToken} 一起改，保持一致。
 */
import type {
  LibraryBridge,
  ProviderStatus,
} from '../../../../../shared/library/ipc'
import { getTmdbAccessToken, setTmdbToken } from '@/features/settings'

/**
 * 引擎还没配置令牌、设置里有值时下发给引擎。返回是否下发了令牌。
 * 引擎不可用（网页版）或出错时什么也不做；只在引擎为空时写，不会覆盖引擎里已有的令牌。
 */
export async function syncTmdbTokenToEngine(
  bridge: Pick<LibraryBridge, 'getProviderStatus' | 'setProviderToken'> | null,
  token: () => string = getTmdbAccessToken
): Promise<boolean> {
  if (!bridge) return false
  try {
    const value = token().trim()
    if (!value || (await bridge.getProviderStatus()).tmdb.configured)
      return false
    await bridge.setProviderToken('tmdb', value)
    return true
  } catch (error) {
    console.warn('同步 TMDB 令牌到媒体库引擎失败', (error as Error).message)
    return false
  }
}

/**
 * 在媒体库设置里修改令牌：先加密存进设置（在线页面的豆瓣 / 详情补充读同一个令牌），再写进引擎。
 * `save` 参数只为测试替换设置层。
 */
export async function saveLibraryTmdbToken(
  bridge: Pick<LibraryBridge, 'setProviderToken'>,
  token: string,
  save: (value: string) => Promise<void> = value => setTmdbToken(value, null)
): Promise<ProviderStatus> {
  const value = token.trim()
  await save(value)
  return bridge.setProviderToken('tmdb', value || null)
}
