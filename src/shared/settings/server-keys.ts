/**
 * 独立服务（src/server）保存的设置：网页端没有主进程，这几个键的值服务端的网盘 / 追更模块、片库刮削（scrape.*）要读，
 * 所以网页端改它们时除了存浏览器，还写到服务端（GET / POST {@link SERVER_SETTINGS_HTTP}）。
 * 值的校验与桌面端相同（shared/settings/schema.ts 的 parseSetting）。
 */
import { SCRAPE_SETTING_KEYS } from '../library/scrape-prefs'
import type { ValueKey } from './schema'

/** 服务端保存的设置键 */
export const SERVER_SETTING_KEYS = [
  'pan115.pansouUrl',
  'pan115.targetCid',
  'pan115.targetName',
  'pan115.movieCid',
  'pan115.movieName',
  'pan115.tvCid',
  'pan115.tvName',
  'library.notify.mountRoot',
  'notify.bark.enabled',
  'notify.bark.server',
  'notify.telegram.enabled',
  'notify.telegram.chatId',
  'notify.on.autograb',
  'notify.on.episode',
  'notify.on.movie',
  'notify.merge',
  ...SCRAPE_SETTING_KEYS,
] as const satisfies readonly ValueKey[]

/** 服务端保存的设置键 */
export type ServerSettingKey = (typeof SERVER_SETTING_KEYS)[number]

/** 路径：GET → {@link ServerSettingsSnapshot}；POST { key, value } → { ok, value } 或 400 */
export const SERVER_SETTINGS_HTTP = '/api/server-settings'

/** 服务端设置快照 */
export interface ServerSettingsSnapshot {
  values: Partial<Record<ServerSettingKey, unknown>>
  /** 被环境变量固定、网页端改不了的键 */
  locked: ServerSettingKey[]
}

/** 是否是服务端保存的设置键 */
export function isServerSettingKey(key: string): key is ServerSettingKey {
  return (SERVER_SETTING_KEYS as readonly string[]).includes(key)
}
