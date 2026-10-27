/**
 * 旧版设置（渲染层 localStorage）到新设置的映射，只用于首启迁移。
 * 迁移器保留一个发布版本后与本文件一起删除。
 */
import { type SecretKey, type SettingValues, parseSetting } from './schema'

/** 旧版存放设置的 localStorage 键 */
export const LEGACY_SETTING_KEYS = [
  'yingbox-theme',
  'adultMode',
  'preferred_player_engine',
  'player_rtx_vsr',
  'player_playback_rate',
  'metadataLanguage',
  'imageDownloadSize_poster',
  'imageDownloadSize_backdrop',
  'imageDownloadSize_actor',
  'scrapeProviderConfig',
] as const

/** 渲染层读到的旧值：键 → localStorage 原始字符串 */
export type LegacySettings = Partial<
  Record<(typeof LEGACY_SETTING_KEYS)[number], string>
>

const flag = (raw: string | undefined): boolean | undefined =>
  raw === '1' ? true : raw === '0' ? false : undefined

const number = (raw: string | undefined): number | undefined =>
  raw === undefined || raw.trim() === '' ? undefined : Number(raw)

function providerConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * 把旧值转换成新设置。纯函数：不合法或缺失的旧值直接跳过，
 * 只返回能通过 schema 校验的项（空字符串视为「没填」，也跳过）。
 * scrapeProviderConfig 只取 TMDB 令牌（{@link legacySecrets}），刮削服务类型与自定义服务已无对应设置。
 */
export function fromLegacy(legacy: LegacySettings): Partial<SettingValues> {
  const candidates: Array<[string, unknown]> = [
    ['app.theme', legacy['yingbox-theme']],
    ['app.adultMode', flag(legacy.adultMode)],
    ['player.engine', legacy.preferred_player_engine],
    ['player.rtxVsr', flag(legacy.player_rtx_vsr)],
    ['player.playbackRate', number(legacy.player_playback_rate)],
    ['scrape.metadataLanguage', legacy.metadataLanguage],
    ['scrape.imageSize.poster', legacy.imageDownloadSize_poster],
    ['scrape.imageSize.backdrop', legacy.imageDownloadSize_backdrop],
    ['scrape.imageSize.actor', legacy.imageDownloadSize_actor],
  ]
  const out: Record<string, unknown> = {}
  for (const [key, raw] of candidates) {
    const change = raw === undefined ? undefined : parseSetting(key, raw)
    if (change) out[change.key] = change.value
  }
  return out as Partial<SettingValues>
}

/**
 * 旧版存在 localStorage 的密钥（明文）→ 新密钥。只取非空字符串；
 * 由主进程迁移时加密写入（系统密钥存储不可用时放弃，不留明文）。
 */
export function legacySecrets(
  legacy: LegacySettings
): Partial<Record<SecretKey, string>> {
  const token = providerConfig(legacy.scrapeProviderConfig).tmdbAccessToken
  return typeof token === 'string' && token.trim()
    ? { 'scrape.tmdbToken': token.trim() }
    : {}
}
