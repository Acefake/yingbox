/**
 * 统一发布的纯规则（ADR-0038）：版本 vX.Y.Z 的 GitHub Release 里放各端安装包，
 * 桌面与安卓更新器都从发布列表里挑出比当前新的最新一版，再按各自的文件名选包。
 * 外部数据一律按未知处理；草稿和 Pre-release 不算。
 */
import { asArray, asRecord, asText } from '../json'

/** 版本三元组 */
export type Version = [number, number, number]

/** 发布里的一个资产（已确认有有效摘要、大小和 https 地址） */
export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** SHA-256（十六进制小写） */
  sha256: string
}

/** 一个发布里挑出来的更新 */
export interface PickedRelease<T> {
  version: string
  notes: string
  publishedAt: string
  asset: T
}

const TAG = /^v(\d+\.\d+\.\d+)$/
/** 单个安装包大小上限 */
export const MAX_ASSET_SIZE = 2 * 1024 ** 3

/** 版本号 x.y.z → 三元组；格式不对返回 null */
export function parseVersion(text: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  if (!m) return null
  const parts: Version = [Number(m[1]), Number(m[2]), Number(m[3])]
  return parts.every(Number.isSafeInteger) &&
    parts[0] <= 214747 &&
    parts[1] < 100 &&
    parts[2] < 100
    ? parts
    : null
}

/** 比较两个版本：a 比 b 新为正，旧为负，相同为 0 */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** GitHub 资产的 digest 字段（"sha256:abcd…"）→ 十六进制；没有或不是 sha256 返回空串 */
export function sha256Of(digest: string): string {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return m ? m[1].toLowerCase() : ''
}

/** 在资产列表里找名为 name 的、能校验的安装包；找不到返回 null */
export function findAsset(
  assets: readonly Record<string, unknown>[],
  name: string
): ReleaseAsset | null {
  for (const asset of assets) {
    if (asText(asset.name) !== name) continue
    const sha256 = sha256Of(asText(asset.digest))
    const url = asText(asset.browser_download_url)
    const size = asset.size
    if (
      sha256 &&
      /^https:\/\//.test(url) &&
      typeof size === 'number' &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      size <= MAX_ASSET_SIZE
    )
      return { name, url, size, sha256 }
  }
  return null
}

/**
 * 从发布列表里挑出比 current 新的最新一版。
 * select 收到该发布的资产和版本号，返回要用的包；返回 null 表示这一版对该端不可用，跳过。
 */
export function newestRelease<T>(
  releases: unknown,
  current: string,
  select: (assets: Record<string, unknown>[], version: string) => T | null
): PickedRelease<T> | null {
  const now = parseVersion(current)
  if (!now) return null
  let best: { version: Version; picked: PickedRelease<T> } | null = null
  for (const raw of asArray(releases)) {
    const release = asRecord(raw)
    if (!release || release.draft === true || release.prerelease === true)
      continue
    const text = TAG.exec(asText(release.tag_name))?.[1]
    const version = text ? parseVersion(text) : null
    if (!text || !version) continue
    if (compareVersions(version, now) <= 0) continue
    if (best && compareVersions(version, best.version) <= 0) continue
    const assets = asArray(release.assets)
      .map(asRecord)
      .filter((a): a is Record<string, unknown> => a !== null)
    const asset = select(assets, text)
    if (!asset) continue
    best = {
      version,
      picked: {
        version: text,
        notes: asText(release.body).trim(),
        publishedAt: asText(release.published_at),
        asset,
      },
    }
  }
  return best?.picked ?? null
}
