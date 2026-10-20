/**
 * 设置层里仍需直接访问 localStorage 的两件事（本文件豁免 localStorage lint 禁令）：
 *
 * 1. 首启迁移：读出旧版散落在 localStorage 的设置，交给主进程并入 settings.json。只读不删。
 * 2. Web / PWA 手机模式：没有主进程，设置只能存在浏览器里（单个键 `yingbox.settings`）；
 *    渲染层可读的密钥（TMDB 令牌）同样只能存在浏览器里（键 `yingbox.secrets`，浏览器没有系统密钥存储）。
 */
import {
  LEGACY_SETTING_KEYS,
  type LegacySettings,
  fromLegacy,
  legacySecrets,
} from '../../../../shared/settings/legacy'
import {
  type ReadableSecretKey,
  type SettingValues,
  type SettingsSnapshot,
  type ValueKey,
  defaultValues,
  parseSetting,
  secretKeys,
} from '../../../../shared/settings/schema'

const WEB_SETTINGS_KEY = 'yingbox.settings'
const WEB_SECRETS_KEY = 'yingbox.secrets'

/** 读出旧版 localStorage 里的设置原值（只读） */
export function readLegacySettings(): LegacySettings {
  const legacy: LegacySettings = {}
  for (const key of LEGACY_SETTING_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) legacy[key] = value
  }
  return legacy
}

/** Web 模式：读取浏览器里保存的设置；第一次读取时并入旧版设置 */
export function loadWebSettings(): SettingsSnapshot {
  const values: Record<string, unknown> = { ...defaultValues() }
  const raw = localStorage.getItem(WEB_SETTINGS_KEY)
  if (raw === null) {
    Object.assign(values, fromLegacy(readLegacySettings()))
    localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(values))
  } else {
    try {
      for (const [key, value] of Object.entries(
        JSON.parse(raw) as Record<string, unknown>
      )) {
        const change = parseSetting(key, value)
        if (change) values[change.key] = change.value
      }
    } catch {
      /* 损坏时用默认值 */
    }
  }
  return {
    values: values as SettingValues,
    secrets: Object.fromEntries(
      secretKeys.map(key => [key, false])
    ) as SettingsSnapshot['secrets'],
    legacyMigrated: true,
  }
}

/** Web 模式：保存一个设置 */
export function saveWebSetting(
  key: ValueKey,
  value: unknown,
  all: SettingValues
): void {
  const change = parseSetting(key, value)
  if (!change) throw new Error(`设置 ${key} 的值不合法`)
  localStorage.setItem(
    WEB_SETTINGS_KEY,
    JSON.stringify({ ...all, [key]: change.value })
  )
}

/** Web 模式：读出浏览器里保存的密钥；第一次读取时并入旧版 scrapeProviderConfig 里的令牌 */
export function loadWebSecret(key: ReadableSecretKey): string {
  let saved: Record<string, unknown> = {}
  const raw = localStorage.getItem(WEB_SECRETS_KEY)
  if (raw === null) {
    saved = { ...legacySecrets(readLegacySettings()) }
    localStorage.setItem(WEB_SECRETS_KEY, JSON.stringify(saved))
  } else {
    try {
      saved = JSON.parse(raw) as Record<string, unknown>
    } catch {
      /* 损坏时视为未配置 */
    }
  }
  const value = saved[key]
  return typeof value === 'string' ? value : ''
}

/** Web 模式：保存一个密钥（空字符串表示清除） */
export function saveWebSecret(key: ReadableSecretKey, value: string): void {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(WEB_SECRETS_KEY) || '{}')
  } catch {
    /* 损坏时整份覆盖 */
  }
  if (value) saved[key] = value
  else delete saved[key]
  localStorage.setItem(WEB_SECRETS_KEY, JSON.stringify(saved))
}
