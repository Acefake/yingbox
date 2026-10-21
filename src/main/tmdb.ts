/**
 * TMDB 令牌只在主进程：设置密钥 `scrape.tmdbToken`（safeStorage 加密落盘）> 环境变量（开发用）。
 *
 * - 在线页面的 TMDB 请求在后台引擎发出（online.tmdb），引擎每次经 host 方法 tmdbToken 向这里要令牌；
 * - 媒体库引擎另存一份（识别 / 刮削在它自己的进程）：用户改令牌时由这里下发，
 *   启动时引擎还没配置而设置里有值（老用户迁移来的令牌）也补一次，不覆盖引擎已有的令牌。
 * 渲染层只写不读：只知道「是否已配置」。
 */
import type { LibraryEngineClient } from './library/host'
import {
  type LibraryTokenTarget,
  syncTmdbTokenToLibrary,
} from './library/platform/token-sync'

export { type LibraryTokenTarget, syncTmdbTokenToLibrary }

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
