/**
 * 检查应用更新（ADR-0038）：读本仓库 GitHub Releases 的发布列表，规则在 shared/android/release。
 * 发布列表缓存 10 分钟（用户反复进设置页不重复请求，也躲开 GitHub 匿名接口的限流）。
 * 地址可用环境变量 YINGBOX_ANDROID_RELEASES_URL 换成镜像或自己的清单（同样的 JSON 形状）。
 */
import {
  type AndroidUpdate,
  pickAndroidUpdate,
} from '../../shared/android/release'

const DEFAULT_URL =
  'https://api.github.com/repos/Acefake/yingbox/releases?per_page=100'
const TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 12_000

export type FetchReleases = () => Promise<unknown>

/** 默认的发布列表请求 */
export function githubReleases(
  url: string = process.env.YINGBOX_ANDROID_RELEASES_URL || DEFAULT_URL
): FetchReleases {
  return async () => {
    const endpoint = new URL(url)
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    const releases: unknown[] = []
    let page = endpoint
    for (let count = 0; count < 20; count++) {
      const response = await fetch(page, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'yingbox-android',
        },
        signal,
      })
      if (!response.ok) throw new Error(`检查更新失败：HTTP ${response.status}`)
      const items: unknown = await response.json()
      if (!Array.isArray(items)) throw new Error('更新发布列表格式错误')
      releases.push(...items)
      const next = /<([^>]+)>;\s*rel="next"/.exec(
        response.headers.get('link') || ''
      )?.[1]
      if (!next) return releases
      page = new URL(next, page)
      if (
        page.origin !== endpoint.origin ||
        page.pathname !== endpoint.pathname
      )
        throw new Error('更新分页地址不匹配')
    }
    throw new Error('更新发布列表页数超限')
  }
}

export function createUpdateChecker(
  fetchReleases: FetchReleases,
  now: () => number = Date.now
): (current: string, abis: readonly string[]) => Promise<AndroidUpdate | null> {
  let cached: { at: number; releases: unknown } | null = null
  let pending: Promise<unknown> | null = null
  return async (current, abis) => {
    if (!cached || now() - cached.at >= TTL_MS) {
      pending ??= fetchReleases()
        .then(releases => {
          cached = { at: now(), releases }
          return releases
        })
        .finally(() => {
          pending = null
        })
      await pending
    }
    if (!cached) return null
    return pickAndroidUpdate(cached.releases, current, abis)
  }
}
