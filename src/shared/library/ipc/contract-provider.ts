/**
 * 媒体库 IPC 契约 · 凭据：元数据源与番号站点的令牌 / Cookie，配置状态只回「是否已配置」。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */

/** 设置元数据源令牌；token 为 null 或空串表示清除。 */
export interface SetProviderTokenRequest {
  provider: TokenProvider
  token: string | null
}

/**
 * 需要用户凭据的来源：tmdb / opensubtitles 令牌，番号站点 theporndb 令牌、
 * javdb 登录 Cookie、dmm_api 凭据（"API_ID:AFFILIATE_ID"）。
 */
export type TokenProvider =
  | 'tmdb'
  | 'opensubtitles'
  | 'theporndb'
  | 'javdb'
  | 'dmm_api'

/** 番号站点的凭据来源。 */
export type JavCredentialProvider = Extract<
  TokenProvider,
  'theporndb' | 'javdb' | 'dmm_api'
>

/** 全部凭据来源，校验用。 */
export const TOKEN_PROVIDERS: readonly TokenProvider[] = [
  'tmdb',
  'opensubtitles',
  'theporndb',
  'javdb',
  'dmm_api',
]

/** 元数据源配置状态（不回传令牌本身）。 */
export type ProviderStatus = Record<TokenProvider, { configured: boolean }>
