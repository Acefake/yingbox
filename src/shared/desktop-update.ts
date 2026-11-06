/**
 * 桌面（Windows）更新的纯规则（ADR-0038）：从 GitHub 发布列表里挑出比当前新的最新一版的安装包
 * yingbox-setup-X.Y.Z.exe，校验值取资产的 digest。
 */
import { findAsset, newestRelease } from './release/pick'

/** 发布页：应用内更新失败时手动下载安装包的入口 */
export const RELEASE_PAGE_URL =
  'https://github.com/Acefake/yingbox/releases/latest'

/** 桌面更新信息 */
export interface DesktopUpdate {
  version: string
  /** 发布说明 */
  notes: string
  /** 安装包文件名 */
  name: string
  url: string
  size: number
  /** 安装包的 SHA-256（十六进制小写） */
  sha256: string
  /** 发布时间（ISO） */
  publishedAt: string
}

/** 从发布列表里找出比当前版本新的最新一版；没有更新返回 null。 */
export function pickDesktopUpdate(
  releases: unknown,
  current: string
): DesktopUpdate | null {
  const picked = newestRelease(releases, current, (assets, version) =>
    findAsset(assets, `yingbox-setup-${version}.exe`)
  )
  if (!picked) return null
  const { asset } = picked
  return {
    version: picked.version,
    notes: picked.notes,
    name: asset.name,
    url: asset.url,
    size: asset.size,
    sha256: asset.sha256,
    publishedAt: picked.publishedAt,
  }
}
