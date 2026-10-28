/**
 * 整理预览的纯规则：按模板算每个视频的目标路径（电影多分段加 ` - partN`，剧集多集合并集号）、
 * 旁挂文件归属（前缀最长者得）、视频冲突连带阻止同条目的其他项。不碰文件系统。
 */
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { ownerFolderDepth } from '../../../../shared/library/parser'
import type {
  LibraryItemNode,
  WriterSettings,
} from '../../../../shared/library/ipc'
import {
  type TemplateValues,
  renderTemplate,
} from '../../../../shared/library/writer'
import type { PlannedMove } from './organize-planner'

/** 去扩展名的文件名。 */
export const stem = (file: string): string => basename(file, extname(file))

/** 作品文件夹的上层作为整理基准，保留媒体库中的分类目录。 */
export function seriesBase(root: string, file: string): string {
  const path = relative(root, dirname(file))
  if (!path || path.startsWith('..') || path.startsWith(sep)) return root
  const folders = path.split(sep)
  const depth = ownerFolderDepth(folders)
  return depth > 1 ? join(root, ...folders.slice(0, depth - 1)) : root
}

/** 一个视频要去的地方。 */
export interface VideoTarget {
  from: string
  to: string | null
  error?: string
}

/** 按模板渲染一个文件的目标路径。 */
function render(
  root: string,
  template: string,
  values: TemplateValues
): { to: string } | { error: string } {
  const result = renderTemplate(template, values)
  return result.ok
    ? { to: join(root, ...result.segments) }
    : { error: result.error }
}

/** 多文件电影：第 2 个起在扩展名前加 ` - partN`（Kodi / Jellyfin 都能识别为分段）。 */
export function withPart(path: string, index: number, count: number): string {
  if (count < 2) return path
  const ext = extname(path)
  return `${path.slice(0, path.length - ext.length)} - part${index + 1}${ext}`
}
/** 电影的各视频目标。 */
export function movieTargets(
  node: LibraryItemNode,
  root: string,
  settings: WriterSettings
): VideoTarget[] {
  const meta = node.metadata?.level === 'title' ? node.metadata : null
  const videos = node.files.filter(f => f.kind === 'video').map(f => f.path)
  if (!meta)
    return videos.map(from => ({
      from,
      to: null,
      error: '条目未识别，无法按模板命名',
    }))
  return videos.map((from, i) => {
    const r = render(root, settings.organize.movieTemplate, {
      title: meta.title,
      originalTitle: meta.originalTitle ?? meta.title,
      year: meta.year,
      tmdbId: meta.externalIds.tmdb ?? meta.ref.id,
      imdbId: meta.externalIds.imdb,
      ext: extname(from).slice(1),
    })
    return 'error' in r
      ? { from, to: null, error: r.error }
      : { from, to: withPart(r.to, i, videos.length) }
  })
}
/** 剧集的各视频目标（一个文件含多集时集号渲染成 01-E02）。 */
export function seriesTargets(
  node: LibraryItemNode,
  root: string,
  settings: WriterSettings
): VideoTarget[] {
  const meta = node.metadata?.level === 'title' ? node.metadata : null
  const episodes = [
    ...node.children.filter(c => c.type === 'episode'),
    ...node.children.filter(c => c.type === 'season').flatMap(s => s.children),
  ]
  const byFile = new Map<string, LibraryItemNode[]>()
  for (const ep of episodes) {
    for (const f of ep.files) {
      if (f.kind === 'video')
        byFile.set(f.path, [...(byFile.get(f.path) ?? []), ep])
    }
  }
  const targets: VideoTarget[] = []
  for (const [from, eps] of byFile) {
    if (!meta) {
      targets.push({ from, to: null, error: '剧集未识别，无法按模板命名' })
      continue
    }
    const numbered = eps
      .map(ep => {
        const em = ep.metadata?.level === 'episode' ? ep.metadata : null
        return {
          season: em?.season ?? ep.seasonNumber,
          episode: em?.episode ?? ep.episodeNumber,
          title: em?.title ?? '',
        }
      })
      .filter(e => e.season !== null && e.episode !== null)
      .sort((a, b) => a.season! - b.season! || a.episode! - b.episode!)
    if (!numbered.length) {
      targets.push({
        from,
        to: null,
        error: '缺少季号或集号（绝对集数未映射）',
      })
      continue
    }
    const r = render(seriesBase(root, from), settings.organize.tvTemplate, {
      title: meta.title,
      series: meta.title,
      originalTitle: meta.originalTitle ?? meta.title,
      year: meta.year,
      tmdbId: meta.externalIds.tmdb ?? meta.ref.id,
      imdbId: meta.externalIds.imdb,
      season: numbered[0].season!,
      episode:
        numbered.length > 1
          ? numbered.map(e => e.episode!)
          : numbered[0].episode!,
      episodeTitle: numbered[0].title,
      ext: extname(from).slice(1),
    })
    targets.push(
      'error' in r ? { from, to: null, error: r.error } : { from, to: r.to }
    )
  }
  return targets.sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * 旁挂文件的归属：以某个视频的文件名（去扩展名）开头、紧跟 `.` 或 `-`，
 * 同时匹配多个时取前缀最长的。都不匹配返回 undefined。
 */
export function sidecarOwner<T extends { stem: string }>(
  name: string,
  owners: T[]
): T | undefined {
  let best: T | undefined
  for (const o of owners) {
    const next = name[o.stem.length]
    if (
      name.startsWith(o.stem) &&
      (next === '.' || next === '-') &&
      (!best || o.stem.length > best.stem.length)
    ) {
      best = o
    }
  }
  return best
}

/** 视频有冲突时，同条目的旁挂与文件夹级文件都不动（否则字幕会和视频分开）。原地修改。 */
export function blockWithConflictingVideo(moves: PlannedMove[]): void {
  const blocked = new Set(
    moves.filter(m => m.kind === 'video' && m.conflict).map(m => m.itemId)
  )
  for (const m of moves) {
    if (m.kind !== 'video' && !m.conflict && blocked.has(m.itemId)) {
      m.conflict = '同条目的视频有冲突，暂不移动'
    }
  }
}
