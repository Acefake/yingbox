/**
 * 凭据的存放：令牌 / Cookie 存在片库设置里（键见 SETTING_KEYS），设置里没有时用环境变量兜底（NAS / Docker）。
 */
import type { TokenProvider } from '../../../shared/library/ipc'
import type { LibraryEnvSecrets } from '../platform/platform'
import {
  type JavCredentials,
  parseDmmApiCredentials,
} from '../providers/jav/sites/registry'
import { SETTING_KEYS, type SettingsStore } from '../providers/settings-store'

/** 凭据来源 → 设置键。 */
export const TOKEN_SETTING_KEYS: Record<TokenProvider, string> = {
  tmdb: SETTING_KEYS.tmdbToken,
  opensubtitles: SETTING_KEYS.opensubtitlesKey,
  theporndb: SETTING_KEYS.theporndbToken,
  javdb: SETTING_KEYS.javdbCookie,
  dmm_api: SETTING_KEYS.dmmApi,
}

/** 番号站点凭据：设置里的优先，没有用环境变量；空白当作没有。 */
export function readJavCredentials(
  settings: Pick<SettingsStore, 'get'>,
  env: LibraryEnvSecrets | undefined
): JavCredentials {
  const read = (key: string, fallback?: string): string | undefined =>
    settings.get(key)?.trim() || fallback?.trim() || undefined
  return {
    theporndbToken: read(SETTING_KEYS.theporndbToken, env?.theporndbToken),
    javdbCookie: read(SETTING_KEYS.javdbCookie, env?.javdbCookie),
    dmmApi: parseDmmApiCredentials(read(SETTING_KEYS.dmmApi, env?.dmmApi)),
  }
}
