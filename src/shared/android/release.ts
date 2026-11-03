/**
 * 安卓端发布与更新的纯规则（ADR-0037）：
 * 发布在本仓库的 GitHub Releases，标签 android-vX.Y.Z（标成 Pre-release，不干扰桌面端 electron-updater 读的 Latest），
 * 每个 ABI 一个包 yingbox-android-X.Y.Z-<abi>.apk。这里解析发布列表、比较版本、按设备支持的 ABI 选包。
 */
import { asArray, asRecord, asText } from '../json'

/** 更新信息（视图 view.appUpdate 的结果） */
export interface AndroidUpdate {
  version: string
  /** 发布说明 */
  notes: string
  /** 该设备能用的那个包的下载地址 */
  url: string
  size: number
  /** 包的 SHA-256（十六进制小写）；只提供有有效摘要的包 */
  sha256: string
  /** 发布时间（ISO） */
  publishedAt: string
}

const TAG = /^android-v(\d+)\.(\d+)\.(\d+)$/

/** 版本号 x.y.z → 三元组；格式不对返回 null */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  if (!m) return null
  const parts: [number, number, number] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ]
  return parts.every(Number.isSafeInteger) &&
    parts[0] <= 214747 &&
    parts[1] < 100 &&
    parts[2] < 100
    ? parts
    : null
}

/** 比较两个版本：a 比 b 新为正，旧为负，相同为 0 */
export function compareVersions(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** GitHub 资产的 digest 字段（"sha256:abcd…"）→ 十六进制；没有或不是 sha256 返回空串 */
const sha256Of = (digest: string): string => {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return m ? m[1].toLowerCase() : ''
}

/**
 * 从 GitHub 发布列表里找出比当前版本新的最新一版，并按 abis（设备支持的 ABI，优先的在前）选包。
 * 外部数据一律按未知处理；草稿不算；没有适合该设备的包的版本跳过；没有更新返回 null。
 */
export function pickAndroidUpdate(
  releases: unknown,
  current: string,
  abis: readonly string[]
): AndroidUpdate | null {
  const now = parseVersion(current)
  if (!now) return null
  let best: {
    version: [number, number, number]
    update: AndroidUpdate
  } | null = null
  for (const raw of asArray(releases)) {
    const release = asRecord(raw)
    if (!release || release.draft === true) continue
    const tag = TAG.exec(asText(release.tag_name))
    if (!tag) continue
    const version = parseVersion(tag.slice(1).join('.'))
    if (!version) continue
    if (compareVersions(version, now) <= 0) continue
    if (best && compareVersions(version, best.version) <= 0) continue
    const assets = asArray(release.assets).map(asRecord)
    let asset: Record<string, unknown> | null | undefined
    for (const abi of abis) {
      if (abi !== 'arm64-v8a' && abi !== 'x86_64') continue
      asset = assets.find(
        a =>
          a &&
          asText(a.name) ===
            `yingbox-android-${version.join('.')}-${abi}.apk` &&
          sha256Of(asText(a.digest)) &&
          typeof a.size === 'number' &&
          Number.isSafeInteger(a.size) &&
          a.size > 0 &&
          a.size <= 1024 ** 3
      )
      if (asset) break
    }
    const url = asset ? asText(asset.browser_download_url) : ''
    if (!asset || !/^https:\/\//.test(url)) continue
    best = {
      version,
      update: {
        version: version.join('.'),
        notes: asText(release.body).trim(),
        url,
        size: asset.size as number,
        sha256: sha256Of(asText(asset.digest)),
        publishedAt: asText(release.published_at),
      },
    }
  }
  return best?.update ?? null
}
