/** 网络优化的跨宿主配置；只包含公开端点，不保存凭据。 */
export interface NetworkPreferences {
  githubMode: 'auto' | 'direct'
  mirrors: string[]
  tmdbMode: 'auto' | 'direct' | 'alternate'
}

/** 经过公开资源探测的候选；实际能力需在请求设备上检测。 */
export const BUILTIN_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghproxy.net/',
]

/** 未配置时沿用官方优先行为。 */
export const DEFAULT_NETWORK: NetworkPreferences = {
  githubMode: 'auto',
  mirrors: BUILTIN_MIRRORS,
  tmdbMode: 'auto',
}

/** 解析 HTTPS 镜像前缀；拒绝凭据、查询参数和本地地址。DNS 由请求边界继续校验。 */
export function parseMirror(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 512) return undefined
  try {
    const url = new URL(raw.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined
    if (
      url.port ||
      !url.hostname.includes('.') ||
      /^(localhost|.*\.localhost|.*\.local)$/.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.includes(':')
    )
      return undefined
    return url.href.endsWith('/') ? url.href : `${url.href}/`
  } catch {
    return undefined
  }
}

/** 设置写入和宿主消息共用的完整配置校验。 */
export function parseNetwork(raw: unknown): NetworkPreferences | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (
    (value.githubMode !== 'auto' && value.githubMode !== 'direct') ||
    (value.tmdbMode !== 'auto' &&
      value.tmdbMode !== 'direct' &&
      value.tmdbMode !== 'alternate') ||
    !Array.isArray(value.mirrors) ||
    value.mirrors.length > 5
  )
    return undefined
  const mirrors = value.mirrors.map(parseMirror)
  if (mirrors.some(x => !x)) return undefined
  return {
    githubMode: value.githubMode,
    tmdbMode: value.tmdbMode,
    mirrors: [...new Set(mirrors.filter((x): x is string => !!x))],
  }
}

/** 官方 TMDB 请求的候选，其他地址保持原样，不改变路径、参数或凭据。 */
export function tmdbCandidates(
  raw: string,
  mode: NetworkPreferences['tmdbMode']
): string[] {
  const url = new URL(raw)
  if (
    url.origin !== 'https://api.themoviedb.org' ||
    !url.pathname.startsWith('/3/')
  )
    return [raw]
  const alternate = new URL(url)
  alternate.hostname = 'api.tmdb.org'
  return mode === 'direct'
    ? [raw]
    : mode === 'alternate'
      ? [alternate.href]
      : [raw, alternate.href]
}
