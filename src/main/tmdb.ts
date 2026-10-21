/**
 * TMDB 令牌只在主进程：设置密钥 `scrape.tmdbToken`（safeStorage 加密落盘）> 环境变量（开发用）。
 *
 * - 在线页面的 TMDB 请求在后台引擎发出（online.tmdb），引擎每次经 host 方法 tmdbToken 向这里要令牌；
 * - 媒体库引擎另存一份（识别 / 刮削在它自己的进程）：用户改令牌时由这里下发，
 *   启动时引擎还没配置而设置里有值（老用户迁移来的令牌）也补一次，不覆盖引擎已有的令牌。
 * 渲染层只写不读：只知道「是否已配置」。
 */
import type { ProviderStatus } from '../shared/library/ipc'
import type { LibraryEngineClient } from './library/host'

/** 设置里的密钥键。 */
export const TMDB_SECRET = 'scrape.tmdbToken'

/**
 * 开发用的默认令牌：环境变量（与媒体库引擎 library/engine/entry.ts 同一套），为空表示未配置。
 * 正式发布不内置令牌，用户在设置里填写。
 */
const ENV_TOKEN: string =
  process.env.YINGBOX_TMDB_TOKEN || process.env.VITE_TMDB_ACCESS_TOKEN || ''

/** 当前生效的令牌：用户填写 > 环境变量 > 空。 */
export function effectiveTmdbToken(
  userToken: string,
  fallback = ENV_TOKEN
): string {
  return userToken.trim() || fallback
}

/** 媒体库引擎里令牌的读写口（只依赖这两个方法，便于测试）。 */
export interface LibraryTokenTarget {
  getProviderStatus(): Promise<ProviderStatus>
  setProviderToken(token: string | null): Promise<unknown>
}

/** 主进程直接调媒体库引擎的 TMDB 令牌接口。 */
export function libraryTokenTarget(
  client: LibraryEngineClient
): LibraryTokenTarget {
  return {
    getProviderStatus: () => client.call('getProviderStatus', undefined),
    setProviderToken: token =>
      client.call('setProviderToken', { provider: 'tmdb', token }),
  }
}

/**
 * 启动时：媒体库引擎还没配置、设置里有用户令牌时下发。返回是否下发了。
 * 设置里没有令牌时不碰引擎（引擎按需启动，不为这件事 fork）。
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
