/**
 * GitHub 发布源镜像改写（ADR-0046）：官方优先，白名单主机才套 gh-proxy 前缀。
 */

/** 公共反代前缀；后接完整官方 https URL */
export const GITHUB_MIRROR_PREFIX = 'https://gh-proxy.com/'

const MIRROR_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
])

/** 是否为允许改写的 GitHub 主机 */
export function isGithubMirrorHost(host: string): boolean {
  return MIRROR_HOSTS.has(host.toLowerCase())
}

/**
 * 官方 URL → 候选列表。非 https 或不合法返回 []；
 * 非白名单主机只返回自身；白名单返回 [官方, 前缀+官方]。
 */
export function mirrorCandidates(url: string): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  if (parsed.protocol !== 'https:') return []
  if (!isGithubMirrorHost(parsed.hostname)) return [url]
  return [url, `${GITHUB_MIRROR_PREFIX}${url}`]
}

/**
 * 安装包下载候选：只接受白名单 GitHub 主机，否则 []（防镜像 JSON 指到外域）。
 */
export function githubAssetCandidates(url: string): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  if (parsed.protocol !== 'https:' || !isGithubMirrorHost(parsed.hostname))
    return []
  return mirrorCandidates(url)
}

/**
 * 是否应尝试下一镜像。status 为 null 表示网络层失败；
 * 429 / ≥500 可换源；其它有状态码不换。
 */
export function shouldTryNextMirror(
  status: number | null,
  _error: unknown
): boolean {
  if (status === null) return true
  if (status === 429) return true
  if (status >= 500) return true
  return false
}
