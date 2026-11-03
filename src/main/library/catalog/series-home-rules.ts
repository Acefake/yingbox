/**
 * 剧的「家」（纯规则）：同一部剧的视频可能分散在几个文件夹（追更散存、整理前后的旧位置），
 * 视频最多的剧文件夹是家；季文件夹按季取家下一层里这一季视频最多的子文件夹。整理并入、追更转存都以它为准（ADR-0029）。
 */
import { basename, dirname, join, relative, sep } from 'node:path'

import { ownerFolderDepth } from '../../../shared/library/parser'

/** 剧的一个视频文件。 */
export interface SeriesVideo {
  path: string
  season: number | null
}

/** 家文件夹与它下面的各季文件夹（都是完整路径）。 */
export interface SeriesHome {
  dir: string
  seasons: Record<number, string>
}

/** 计数最多的键；并列时取先出现的。 */
function mostCommon(counts: Map<string, number>): string | undefined {
  let best: string | undefined
  for (const [key, n] of counts) if (!best || n > counts.get(best)!) best = key
  return best
}

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/**
 * 从一部剧的视频里选出家。直接放在根目录、不在根目录下的视频不算任何剧文件夹；都不算时返回 null。
 * @param root 媒体库根目录
 */
export function pickSeriesHome(
  root: string,
  videos: readonly SeriesVideo[]
): SeriesHome | null {
  const owners = new Map<string, number>()
  const ownerOf = new Map<SeriesVideo, string>()
  for (const video of videos) {
    const rel = relative(root, dirname(video.path))
    if (
      !rel ||
      rel.startsWith('..') ||
      rel.startsWith(sep) ||
      /^[a-z]:/i.test(rel)
    )
      continue
    const folders = rel.split(sep)
    const depth = ownerFolderDepth(folders, basename(video.path))
    if (!depth) continue
    const owner = join(root, ...folders.slice(0, depth))
    ownerOf.set(video, owner)
    bump(owners, owner)
  }
  const dir = mostCommon(owners)
  if (!dir) return null
  const bySeason = new Map<number, Map<string, number>>()
  for (const video of videos) {
    const folder = dirname(video.path)
    // 只认家文件夹下一层的子文件夹（Season 01），发布包里更深的目录不当季文件夹
    if (
      ownerOf.get(video) !== dir ||
      dirname(folder) !== dir ||
      video.season === null
    )
      continue
    const counts = bySeason.get(video.season) ?? new Map<string, number>()
    bump(counts, folder)
    bySeason.set(video.season, counts)
  }
  const seasons: Record<number, string> = {}
  for (const [season, counts] of bySeason) seasons[season] = mostCommon(counts)!
  return { dir, seasons }
}
