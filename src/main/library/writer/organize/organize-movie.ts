/**
 * 电影整理的纯规则（ADR-0029）：
 * - 广告：远小于主视频的视频（< 最大者 5% 且 < 200 MB，如「x u u 6 2 . c o m.mp4」）不整理、原地留下；
 * - 分段与版本：文件名（或碟片文件夹）都带分段号（CD1 / part2）时才是分段，加 ` - partN`；
 *   否则是同一部电影的多个版本，按画质 / 来源加 ` - 2160p REMUX`，标签重复或读不出时用 ` - 版本N`；
 * - 基准：主视频直接所在的文件夹不是这部电影自己的（「电影/Buddy.mkv」里的「电影」）时，它是分类文件夹，
 *   新文件夹建在它里面；否则建在电影文件夹的上层，保留媒体库中的分类目录。
 */
import { basename, dirname, join, relative, sep } from 'node:path'

import {
  isWorkFolder,
  ownerFolderDepth,
  parseMediaPath,
} from '../../../../shared/library/parser'
import { resolutionOf } from '../../catalog/merge/version-rules'

/** 广告判定：比最大视频小于这个比例 */
const AD_RATIO = 0.05
/** 广告判定：且小于这个体积 */
const AD_MAX_BYTES = 200 * 1024 ** 2

/** 电影的一个视频。 */
export interface MovieVideo {
  path: string
  size: number
}

/** 分段号（CD1 / part2 / 碟片文件夹）；没有为 undefined。 */
function partOf(path: string): number | undefined {
  const parsed = parseMediaPath(path, { forceMovie: true })
  return parsed.type === 'movie' ? parsed.part : undefined
}

/** 去掉广告视频（带分段号的不算，再小也是正片的一段）；只有一个视频时原样返回。 */
export function withoutAds(videos: readonly MovieVideo[]): MovieVideo[] {
  const largest = Math.max(0, ...videos.map(v => v.size))
  return videos.filter(
    v =>
      v.size >= largest * AD_RATIO ||
      v.size >= AD_MAX_BYTES ||
      partOf(v.path) !== undefined
  )
}

const SOURCES: ReadonlyArray<[RegExp, string]> = [
  [/(?:^|[^a-z])remux(?![a-z])/i, 'REMUX'],
  [/(?:^|[^a-z])blu-?ray(?![a-z])/i, 'BluRay'],
  [/(?:^|[^a-z])web-?dl(?![a-z])/i, 'WEB-DL'],
  [/(?:^|[^a-z])webrip(?![a-z])/i, 'WEBRip'],
  [/(?:^|[^a-z])hdtv(?![a-z])/i, 'HDTV'],
  [/(?:^|[^a-z])dvdrip(?![a-z])/i, 'DVDRip'],
]

/** 版本标签：分辨率 + 来源（「2160p REMUX」）；都读不出为空串。 */
export function versionLabel(path: string): string {
  const name = basename(path)
  const height = resolutionOf(path)
  const source = SOURCES.find(([re]) => re.test(name))?.[1]
  return [height ? `${height}p` : '', source ?? ''].filter(Boolean).join(' ')
}

/**
 * 每个视频文件名要加的后缀（与 paths 同序）：一个视频为空串；都带分段号时按分段号排成 ` - partN`；
 * 否则是多版本。
 */
export function movieSuffixes(paths: readonly string[]): string[] {
  if (paths.length < 2) return paths.map(() => '')
  const parts = paths.map(partOf)
  if (
    parts.every(p => p !== undefined) &&
    new Set(parts).size === parts.length
  ) {
    const order = [...parts].sort((a, b) => a! - b!)
    return parts.map(p => ` - part${order.indexOf(p) + 1}`)
  }
  const labels = paths.map(versionLabel)
  return labels.map((label, i) =>
    label && labels.indexOf(label) === labels.lastIndexOf(label)
      ? ` - ${label}`
      : ` - 版本${i + 1}`
  )
}

/**
 * 电影的整理基准。
 * @param titles 用来认电影自己文件夹的片名（文件名解析出的、TMDB 的中文名与原名）
 */
export function movieBase(
  root: string,
  file: string,
  titles: string[]
): string {
  const rel = relative(root, dirname(file))
  if (
    !rel ||
    rel.startsWith('..') ||
    rel.startsWith(sep) ||
    /^[a-z]:/i.test(rel)
  )
    return root
  const folders = rel.split(sep)
  const depth = ownerFolderDepth(folders)
  if (depth === folders.length && !isWorkFolder(folders[depth - 1], titles))
    return join(root, ...folders)
  return depth > 1 ? join(root, ...folders.slice(0, depth - 1)) : root
}
