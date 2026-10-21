/**
 * 媒体库设置里修改 TMDB 令牌。
 * - 桌面端：权威副本是设置密钥 `scrape.tmdbToken`（主进程 safeStorage），主进程保存时一并下发给媒体库引擎，
 *   启动时也会补给还没配置的引擎（见 src/main/tmdb.ts）；
 * - 网页端：bridge 提供 setProviderToken，片库服务存进自己的密钥文件并下发给片库（见 src/server）。
 */
import type {
  LibraryBridge,
  ProviderStatus,
} from '../../../../../shared/library/ipc'
import { setTmdbToken } from '@/features/settings'

/**
 * 保存令牌（主进程加密存进设置并写进引擎），返回引擎里的配置状态。
 * `save` 参数只为测试替换设置层。
 */
export async function saveLibraryTmdbToken(
  bridge: Pick<LibraryBridge, 'getProviderStatus' | 'setProviderToken'>,
  token: string,
  save: (value: string) => Promise<void> = setTmdbToken
): Promise<ProviderStatus> {
  if (bridge.setProviderToken)
    return bridge.setProviderToken(token.trim() || null)
  await save(token.trim())
  return bridge.getProviderStatus()
}
