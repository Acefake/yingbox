/**
 * 安卓端更新的纯规则（ADR-0038）：
 * 安卓包与各端安装包放在同一个 GitHub Release（标签 vX.Y.Z），每个 ABI 一个包 yingbox-android-X.Y.Z-<abi>.apk。
 * 这里按设备支持的 ABI 从发布列表里选包，版本规则在 shared/release/pick。
 */
import { findAsset, newestRelease } from '../release/pick'

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

/** 从发布列表里找出比当前版本新的最新一版，并按 abis（设备支持的 ABI，优先的在前）选包；没有更新返回 null。 */
export function pickAndroidUpdate(
  releases: unknown,
  current: string,
  abis: readonly string[]
): AndroidUpdate | null {
  const picked = newestRelease(releases, current, (assets, version) => {
    for (const abi of abis) {
      if (abi !== 'arm64-v8a' && abi !== 'x86_64') continue
      const asset = findAsset(assets, `yingbox-android-${version}-${abi}.apk`)
      if (asset) return asset
    }
    return null
  })
  if (!picked) return null
  const { asset } = picked
  return {
    version: picked.version,
    notes: picked.notes,
    url: asset.url,
    size: asset.size,
    sha256: asset.sha256,
    publishedAt: picked.publishedAt,
  }
}
