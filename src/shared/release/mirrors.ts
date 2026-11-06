import {
  DEFAULT_NETWORK,
  type NetworkPreferences,
} from '../network/preferences'
/**
 * GitHub 发布源镜像改写（ADR-0051）：官方优先，按配置与用途选择候选。
 */

/** 公共反代前缀；后接完整官方 https URL */
export const GITHUB_MIRROR_PREFIX = 'https://gh-proxy.com/'

const MIRROR_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
])

/** 是否为允许改写的 GitHub 主机 */
export function isGithubMirrorHost(host: string): boolean {
  return MIRROR_HOSTS.has(host.toLowerCase())
}

/**
 * 官方 URL → 候选列表。非 https 或不合法返回 []；
 * 非白名单主机只返回自身；白名单使用已启用且支持该用途的镜像。
 */
export function mirrorCandidates(
  url: string,
  preferences: NetworkPreferences = DEFAULT_NETWORK
): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  if (parsed.protocol !== 'https:') return []
  if (!isGithubMirrorHost(parsed.hostname)) return [url]
  if (parsed.username || parsed.password || parsed.port) return []
  if (preferences.githubMode === 'direct') return [url]
  const mirrors = preferences.mirrors.filter(
    prefix =>
      parsed.hostname !== 'api.github.com' || prefix === GITHUB_MIRROR_PREFIX
  )
  return [url, ...mirrors.map(prefix => `${prefix}${url}`)]
}

/**
 * 安装包下载候选：只接受白名单 GitHub 主机，否则 []（防镜像 JSON 指到外域）。
 */
export function githubAssetCandidates(
  url: string,
  preferences: NetworkPreferences = DEFAULT_NETWORK
): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  if (parsed.protocol !== 'https:' || !isGithubMirrorHost(parsed.hostname))
    return []
  return mirrorCandidates(url, preferences)
}

/**
 * 是否应尝试下一候选。status 为 null 表示网络层失败。
 *
 * 官方候选（`viaMirror` 为 false）：≥500 与网络层失败换源，鉴权、权限和限流状态不换源（ADR-0051）。
 * 镜像候选（`viaMirror` 为 true）：镜像自身返回的任何非 2xx（配额耗尽、路径不支持）都说明
 * 这个反代不可用，与本应用的鉴权无关，换下一个候选（ADR-0055）。
 */
export function shouldTryNextMirror(
  status: number | null,
  _error: unknown,
  viaMirror = false
): boolean {
  if (status === null) return true
  if (viaMirror) return true
  if (status === 429) return false
  if (status >= 500) return true
  return false
}
