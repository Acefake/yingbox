/**
 * 版本的纯规则：把一个节点（电影 / 集）的视频文件分成可播放的版本，并按好坏排序。
 *
 * - 分组：同一文件夹里带分段号（CD1 / part2）的文件合成一个版本，按分段号排；其余每个文件各是一个版本；
 * - 分辨率：文件名优先，读不出再看所在文件夹名（发布组常把规格写在文件夹上）；
 * - 动态范围：ffprobe 探测结果优先，没探测过时看文件名里的 DV / HDR 标记；
 * - 排序：分辨率 > 动态范围 > 体积，全都一样时按路径，结果稳定。
 */
import type {
  LibraryItemFile,
  LibraryVersion,
} from '../../../../shared/library/ipc'
import { ownerFolderDepth } from '../../../../shared/library/parser'
import {
  VIDEO_RANGE_RANK,
  type VideoRange,
} from '../../../../shared/video-range'

/** 版本分组需要的、文件行之外的信息。 */
export interface VersionFileMeta {
  /** 解析出的分段号；没有为 null。 */
  part: number | null
  /** 文件所属的本地顶层条目。 */
  itemId: number
  libraryId: number
}

/** 路径的最后一段与上一级文件夹（Windows 反斜杠与正斜杠都认）。 */
function splitPath(path: string): {
  dir: string
  base: string
  parent: string
} {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dir = cut >= 0 ? path.slice(0, cut) : ''
  const pcut = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
  return {
    dir,
    base: path.slice(cut + 1),
    parent: dir.slice(pcut + 1),
  }
}

const RESOLUTION_RE =
  /(?:^|[^a-z0-9])(4320|2160|1440|1080|720|576|540|480|360)[pi](?![a-z0-9])/i
const DIMENSIONS_RE = /(?:^|[^0-9])\d{3,4}[x×](\d{3,4})(?![0-9])/i
const TOKEN_HEIGHT: ReadonlyArray<[RegExp, number]> = [
  [/(?:^|[^a-z0-9])8k(?![a-z0-9])/i, 4320],
  [/(?:^|[^a-z0-9])(?:4k|uhd)(?![a-z0-9])/i, 2160],
  [/(?:^|[^a-z0-9])2k(?![a-z0-9])/i, 1440],
  [/(?:^|[^a-z0-9])fhd(?![a-z0-9])/i, 1080],
]

/** 一段名字里写明的分辨率（垂直像素）；没有为 null。 */
function heightIn(name: string): number | null {
  const res = RESOLUTION_RE.exec(name)
  if (res) return Number(res[1])
  const dims = DIMENSIONS_RE.exec(name)
  if (dims) return Number(dims[1])
  for (const [re, height] of TOKEN_HEIGHT) if (re.test(name)) return height
  return null
}

/** 文件的分辨率：文件名优先，其次所在文件夹名。 */
export function resolutionOf(path: string): number | null {
  const { base, parent } = splitPath(path)
  return heightIn(base) ?? heightIn(parent)
}

const DV_NAME_RE = /(?:^|[^a-z0-9])(?:dv|dovi|dolby[ ._-]?vision)(?![a-z0-9])/i
const HDR_NAME_RE = /(?:^|[^a-z0-9])hdr(?:10\+?|10plus)?(?![a-z0-9])/i
const HLG_NAME_RE = /(?:^|[^a-z0-9])hlg(?![a-z0-9])/i

/** 文件的动态范围：探测结果优先，否则看文件名标记；都没有为 null。 */
export function rangeOf(file: LibraryItemFile): VideoRange | null {
  if (file.video) return file.video.range
  const { base } = splitPath(file.path)
  if (DV_NAME_RE.test(base)) return 'dv'
  if (HDR_NAME_RE.test(base)) return 'hdr10'
  if (HLG_NAME_RE.test(base)) return 'hlg'
  return null
}

const rangeRank = (range: VideoRange | null): number =>
  range === null ? -1 : VIDEO_RANGE_RANK[range]

const better = (
  a: VideoRange | null,
  b: VideoRange | null
): VideoRange | null => (rangeRank(b) > rangeRank(a) ? b : a)

/** 版本排序：分辨率 > 动态范围 > 体积（都是大的在前），最后按文件夹和首个文件 id。 */
export function compareVersions(a: LibraryVersion, b: LibraryVersion): number {
  return (
    (b.height ?? 0) - (a.height ?? 0) ||
    rangeRank(b.range) - rangeRank(a.range) ||
    b.size - a.size ||
    a.folder.localeCompare(b.folder) ||
    a.fileIds[0] - b.fileIds[0]
  )
}

/**
 * 把一个节点的视频文件分成版本，最好的在前。
 * @param files 节点的文件（非视频的忽略）
 * @param meta 文件 id → 分段号与所属条目；查不到的文件不进版本
 */
export function buildVersions(
  files: readonly LibraryItemFile[],
  meta: ReadonlyMap<number, VersionFileMeta>
): LibraryVersion[] {
  const groups = new Map<string, LibraryItemFile[]>()
  for (const file of files) {
    const m = meta.get(file.id)
    if (file.kind !== 'video' || !m) continue
    const { dir } = splitPath(file.path)
    // 带分段号的同文件夹文件合成一组；其余每个文件单独成组
    const key = m.part === null ? `f:${file.id}` : `p:${m.itemId}:${dir}`
    const group = groups.get(key)
    if (group) group.push(file)
    else groups.set(key, [file])
  }
  const versions: LibraryVersion[] = []
  for (const group of groups.values()) {
    group.sort(
      (x, y) =>
        (meta.get(x.id)!.part ?? 0) - (meta.get(y.id)!.part ?? 0) ||
        x.path.localeCompare(y.path, undefined, { numeric: true })
    )
    const first = group[0]
    const m = meta.get(first.id)!
    versions.push({
      key: `f${first.id}`,
      fileIds: group.map(f => f.id),
      height: group.reduce<number | null>((h, f) => {
        const r = resolutionOf(f.path)
        return r !== null && (h === null || r > h) ? r : h
      }, null),
      range: group.reduce<VideoRange | null>(
        (r, f) => better(r, rangeOf(f)),
        null
      ),
      size: group.reduce((n, f) => n + f.size, 0),
      folder: splitPath(first.path).dir,
      itemId: m.itemId,
      libraryId: m.libraryId,
    })
  }
  return versions.sort(compareVersions)
}

/** 一组路径的公共文件夹（按路径段比较，保留第一条路径的原始写法）；没有公共部分为空串。 */
export function commonFolder(paths: readonly string[]): string {
  if (!paths.length) return ''
  const segs = (p: string): string[] => p.split(/[\\/]/)
  const first = segs(splitPath(paths[0]).dir)
  let n = first.length
  for (const path of paths.slice(1)) {
    const other = segs(splitPath(path).dir)
    let i = 0
    while (i < n && i < other.length && other[i] === first[i]) i++
    n = i
  }
  // 按段数在原字符串里截取，保留原分隔符
  let cut = 0
  const dir = splitPath(paths[0]).dir
  for (let i = 0; i < n; i++) {
    cut += first[i].length + (i < n - 1 ? 1 : 0)
  }
  return dir.slice(0, cut)
}

/**
 * 作品文件夹：去掉末尾的季 / 碟片 / 附加内容等结构性文件夹（「Show/Season 1」→「Show」）；
 * 认不出作品文件夹时原样返回。
 */
export function ownerFolder(dir: string): string {
  const segs = dir.split(/[\\/]/)
  const depth = ownerFolderDepth(segs)
  if (depth <= 0 || depth >= segs.length) return dir
  let cut = 0
  for (let i = 0; i < depth; i++) cut += segs[i].length + 1
  return dir.slice(0, cut - 1)
}
