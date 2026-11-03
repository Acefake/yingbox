/**
 * 整理预览的纯规则：按模板算每个视频的目标路径（电影多分段加 ` - partN`，剧集多集合并集号，散存的集并入剧的家）、
 * 旁挂文件归属（前缀最长者得）、视频冲突连带阻止同条目的其他项。不碰文件系统。
 */
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path'
import { folderLayout, parseMediaPath } from '../../../../shared/library/parser'
import type {
  LibraryItemNode,
  WriterSettings,
} from '../../../../shared/library/ipc'
import {
  type TemplateValues,
  renderTemplate,
} from '../../../../shared/library/writer'
import type { SeriesHome } from '../../catalog/series-home-rules'
import { movieBase, movieSuffixes, withoutAds } from './organize-movie'
import type { PlannedMove } from './organize-planner'

/** 去扩展名的文件名。 */
export const stem = (file: string): string => basename(file, extname(file))

/** 整理基准：作品文件夹的上层，或集直接所在的分类文件夹，保留媒体库中的分类目录（见 folderLayout）。 */
export function seriesBase(root: string, file: string): string {
  const path = relative(root, dirname(file))
  if (!path || path.startsWith('..') || path.startsWith(sep)) return root
  const folders = path.split(sep)
  const { base } = folderLayout(folders, basename(file))
  return base ? join(root, ...folders.slice(0, base)) : root
}

/** 一个视频要去的地方。 */
export interface VideoTarget {
  from: string
  to: string | null
  error?: string
  /** 剧集：整理后的剧文件夹（文件夹级文件跟到这里）；模板只有一段时没有 */
  seriesDir?: string
}

/**
 * 剧要并入的家（ADR-0029）：条目有视频在家文件夹以外（追更散存的新集）时才并入；
 * 视频都在家里时照常按模板整理（可能连家文件夹一起改名）。
 */
export function mergeHome(
  videos: readonly string[],
  home: SeriesHome | null | undefined
): SeriesHome | null {
  if (!home || !videos.length) return null
  const inside = (video: string): boolean => {
    const rel = relative(home.dir, video)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
  return videos.every(inside) ? null : home
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

/** 在扩展名前插入后缀（` - part2`、` - 2160p REMUX`）。 */
function withSuffix(path: string, suffix: string): string {
  const ext = extname(path)
  return `${path.slice(0, path.length - ext.length)}${suffix}${ext}`
}

/** 电影的各视频目标（分段 / 多版本 / 广告 / 分类基准见 organize-movie.ts）；广告视频不在结果里，原地留下。 */
export function movieTargets(
  node: LibraryItemNode,
  root: string,
  settings: WriterSettings
): VideoTarget[] {
  const meta = node.metadata?.level === 'title' ? node.metadata : null
  const videos = withoutAds(node.files.filter(f => f.kind === 'video'))
  if (!meta)
    return videos.map(v => ({
      from: v.path,
      to: null,
      error: '条目未识别，无法按模板命名',
    }))
  const main = videos.reduce((a, b) => (b.size > a.size ? b : a), videos[0])
  if (!main) return []
  const named = parseMediaPath(main.path)
  const base = movieBase(root, main.path, [
    named.title,
    named.altTitle ?? '',
    meta.title,
    meta.originalTitle ?? '',
  ])
  const suffixes = movieSuffixes(videos.map(v => v.path))
  return videos.map(({ path: from }, i) => {
    const r = render(base, settings.organize.movieTemplate, {
      title: meta.title,
      originalTitle: meta.originalTitle ?? meta.title,
      year: meta.year,
      tmdbId: meta.externalIds.tmdb ?? meta.ref.id,
      imdbId: meta.externalIds.imdb,
      ext: extname(from).slice(1),
    })
    return 'error' in r
      ? { from, to: null, error: r.error }
      : { from, to: withSuffix(r.to, suffixes[i]) }
  })
}
/** 剧集的各视频目标（一个文件含多集时集号渲染成 01-E02）。 */
export function seriesTargets(
  node: LibraryItemNode,
  root: string,
  settings: WriterSettings,
  home: SeriesHome | null = null
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
    const base = seriesBase(root, from)
    const r = render(base, settings.organize.tvTemplate, {
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
    if ('error' in r) {
      targets.push({ from, to: null, error: r.error })
      continue
    }
    const [top, ...tail] = relative(base, r.to).split(sep)
    if (!tail.length) targets.push({ from, to: r.to })
    else if (home) {
      // 家里已有这一季的文件夹（可能叫 Season 1）就进它，不按模板再建一个
      const seasonDir = tail.length > 1 && home.seasons[numbered[0].season!]
      const to = seasonDir
        ? join(seasonDir, ...tail.slice(1))
        : join(home.dir, ...tail)
      targets.push({ from, to, seriesDir: home.dir })
    } else targets.push({ from, to: r.to, seriesDir: join(base, top) })
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
