/**
 * 整理预览：按模板算出每个视频的新位置，带上跟随它的旁挂文件（字幕、nfo、-poster 等）
 * 与文件夹级文件（poster.jpg、tvshow.nfo、.actors/ ……），并检查冲突。只读，不动任何文件。
 *
 * 旁挂文件的认定：同目录下以视频文件名（去扩展名）开头、紧跟 `.` 或 `-` 的文件，
 * 如 `Movie.zh.srt`、`Movie.nfo`、`Movie-poster.jpg`、`Movie-trailer.mkv`；
 * 同时匹配多个视频时归属前缀最长的那个（`Movie.part2.srt` 属于 `Movie.part2.mkv`）。
 * 改名时只替换前缀，后缀原样保留。
 *
 * 文件夹级文件只在“整个文件夹属于这个条目”时跟着走：电影独占的文件夹、剧集文件夹、季文件夹，
 * 且新旧文件夹不同。系统垃圾文件（.DS_Store、Thumbs.db、@eaDir……）不移动，执行后随空目录一起清理。
 */
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type {
  LibraryItemNode,
  OrganizeEntry,
  WriterSettings,
} from '../../../../shared/library/ipc'
import {
  type TemplateValues,
  renderTemplate,
} from '../../../../shared/library/writer'
import type { LibraryRecord } from '../../libraries/library-store'
import { VIDEO_EXTENSIONS } from '../../scanner/rules'
import { exists } from '../fs/file-ops'

/** 不移动的系统文件与我们自己的临时文件。 */
export const JUNK_RE =
  /^(?:\.ds_store|thumbs\.db|desktop\.ini|@eadir|\..+\.yb-[0-9a-f]{8}\.(?:tmp|part))$/i

/** 计划里的一项（引擎内部形状，比 IPC 多了媒体库 id）。 */
export interface PlannedMove extends OrganizeEntry {
  libraryId: number
}

/** 预览结果。 */
export interface OrganizePreview {
  moves: PlannedMove[]
  unchanged: number
}

/** 预览需要的依赖（文件系统部分可注入，测试模拟跨盘）。 */
export interface PlannerDeps {
  getItem(id: number): LibraryItemNode | null
  library(id: number): LibraryRecord
  /** 目录里属于其他顶层条目的视频。 */
  foreignVideos(dir: string, topItemId: number): string[]
  /** 目录所在设备号；缺省用 stat(dir).dev（不存在时向上找存在的祖先）。 */
  deviceOf?: (path: string) => Promise<number | undefined>
}

const isVideo = (name: string): boolean =>
  VIDEO_EXTENSIONS.has(extname(name).toLowerCase())

const stem = (file: string): string => basename(file, extname(file))

/** 路径长度上限：Windows（含 UNC / 盘符路径）260，其余 4096。 */
export function pathLimit(root: string): number {
  return process.platform === 'win32' || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(root)
    ? 259
    : 4095
}

/** 目标重名比较用的键：一律不分大小写（媒体库可能被 Windows / macOS 访问）。 */
const collisionKey = (path: string): string => path.toLowerCase()

/** 默认设备号：沿父目录找到第一个存在的路径。 */
async function defaultDeviceOf(path: string): Promise<number | undefined> {
  let current = path
  for (;;) {
    try {
      return (await stat(current)).dev
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

/** 一个视频要去的地方。 */
interface VideoTarget {
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
function withPart(path: string, index: number, count: number): string {
  if (count < 2) return path
  const ext = extname(path)
  return `${path.slice(0, path.length - ext.length)} - part${index + 1}${ext}`
}

/** 电影的各视频目标。 */
function movieTargets(
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
function seriesTargets(
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
    const r = render(root, settings.organize.tvTemplate, {
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

/** 目录列表缓存（同一次预览里每个目录只读一次）。 */
class DirCache {
  private readonly cache = new Map<string, Promise<Dirent[]>>()

  list(dir: string): Promise<Dirent[]> {
    let p = this.cache.get(dir)
    if (!p) {
      p = readdir(dir, { withFileTypes: true }).catch(() => [])
      this.cache.set(dir, p)
    }
    return p
  }
}

/** 预览一个顶层条目。 */
async function planItem(
  node: LibraryItemNode,
  library: LibraryRecord,
  settings: WriterSettings,
  deps: PlannerDeps,
  dirs: DirCache
): Promise<{ moves: PlannedMove[]; unchanged: number }> {
  const root = library.root
  const targets =
    node.type === 'movie'
      ? movieTargets(node, root, settings)
      : seriesTargets(node, root, settings)
  const moves: PlannedMove[] = []
  const add = (
    kind: PlannedMove['kind'],
    from: string,
    to: string,
    conflict?: string
  ): void => {
    moves.push({
      itemId: node.id,
      libraryId: library.id,
      kind,
      from,
      to,
      crossDevice: false,
      ...(conflict ? { conflict } : {}),
    })
  }
  let unchanged = 0
  const itemVideos = targets.map(t => t.from)
  const assigned = new Set(itemVideos)

  // 视频与旁挂
  const byDir = new Map<string, VideoTarget[]>()
  for (const t of targets)
    byDir.set(dirname(t.from), [...(byDir.get(dirname(t.from)) ?? []), t])
  for (const [dir, list] of byDir) {
    const foreign = deps.foreignVideos(dir, node.id)
    const owners = [
      ...list.map(t => ({ t, stem: stem(t.from) })),
      ...foreign.map(f => ({ t: null, stem: stem(f) })),
    ]
    const sidecars = new Map<VideoTarget, string[]>()
    for (const entry of await dirs.list(dir)) {
      const path = join(dir, entry.name)
      if (!entry.isFile() || assigned.has(path) || foreign.includes(path))
        continue
      let best: (typeof owners)[number] | undefined
      for (const o of owners) {
        const next = entry.name[o.stem.length]
        if (
          entry.name.startsWith(o.stem) &&
          (next === '.' || next === '-') &&
          (!best || o.stem.length > best.stem.length)
        ) {
          best = o
        }
      }
      if (best?.t) {
        sidecars.set(best.t, [...(sidecars.get(best.t) ?? []), entry.name])
        assigned.add(path)
      }
    }
    for (const t of list) {
      if (!t.to) {
        add('video', t.from, '', t.error)
        continue
      }
      if (t.to === t.from) unchanged++
      else add('video', t.from, t.to)
      const oldStem = stem(t.from)
      const newBase = join(dirname(t.to), stem(t.to))
      for (const name of sidecars.get(t) ?? []) {
        const to = `${newBase}${name.slice(oldStem.length)}`
        if (to !== join(dir, name)) add('sidecar', join(dir, name), to)
      }
    }
  }

  // 文件夹级文件：旧文件夹整个属于这个条目、且新旧文件夹不同
  const moveFolder = async (oldDir: string, newDir: string): Promise<void> => {
    if (oldDir === newDir || oldDir === root) return
    for (const entry of await dirs.list(oldDir)) {
      const path = join(oldDir, entry.name)
      if (assigned.has(path) || JUNK_RE.test(entry.name)) continue
      if (entry.isDirectory() && itemVideos.some(v => v.startsWith(path + sep)))
        continue
      if (entry.isFile() && isVideo(entry.name)) continue
      if (!entry.isFile() && !entry.isDirectory()) continue
      assigned.add(path)
      add('folder', path, join(newDir, entry.name))
    }
  }
  const resolved = targets.filter(
    (t): t is VideoTarget & { to: string } => !!t.to
  )
  const oneDir = (paths: string[]): string | null => {
    const set = new Set(paths.map(p => dirname(p)))
    return set.size === 1 ? [...set][0] : null
  }
  if (node.type === 'movie') {
    for (const [dir, list] of byDir) {
      const newDir = oneDir(list.filter(t => t.to).map(t => t.to!))
      if (newDir && !deps.foreignVideos(dir, node.id).length)
        await moveFolder(dir, newDir)
    }
  } else {
    const firstSegment = (p: string): string => relative(root, p).split(sep)[0]
    const oldSeries = new Set(itemVideos.map(firstSegment))
    const newSeries = new Set(resolved.map(t => firstSegment(t.to)))
    // 季文件夹先处理（它们在剧集文件夹里，要整体挪走的话不能被当成剧集级目录）
    for (const [dir, list] of byDir) {
      const seriesDir = join(root, firstSegment(dir))
      if (dir === seriesDir || dirname(dir) !== seriesDir) continue
      const newDir = oneDir(list.filter(t => t.to).map(t => t.to!))
      if (newDir && newDir !== join(root, firstSegment(newDir)))
        await moveFolder(dir, newDir)
    }
    if (oldSeries.size === 1 && newSeries.size === 1) {
      const oldDir = join(root, [...oldSeries][0])
      const newDir = join(root, [...newSeries][0])
      if (
        resolved.every(t => dirname(t.to) !== root) &&
        itemVideos.every(v => dirname(v) !== root)
      ) {
        await moveFolder(oldDir, newDir)
      }
    }
  }
  return { moves, unchanged }
}

/** 整理预览：计划 + 冲突检查。 */
export async function planOrganize(
  topItemIds: number[],
  settings: WriterSettings,
  deps: PlannerDeps
): Promise<OrganizePreview> {
  const dirs = new DirCache()
  const moves: PlannedMove[] = []
  let unchanged = 0
  for (const id of topItemIds) {
    const node = deps.getItem(id)
    if (!node || (node.type !== 'movie' && node.type !== 'series')) continue
    const r = await planItem(
      node,
      deps.library(node.libraryId),
      settings,
      deps,
      dirs
    )
    moves.push(...r.moves)
    unchanged += r.unchanged
  }

  // 冲突：计划内撞名、磁盘上已存在、路径过长
  const sources = new Set(moves.map(m => collisionKey(m.from)))
  const taken = new Map<string, PlannedMove>()
  const deviceOf = deps.deviceOf ?? defaultDeviceOf
  for (const m of moves) {
    if (m.conflict) continue
    const key = collisionKey(m.to)
    const limit = pathLimit(deps.library(m.libraryId).root)
    if (taken.has(key)) m.conflict = '与计划里另一项的目标重名'
    else if (m.to.length > limit)
      m.conflict = `路径过长（${m.to.length} 字符，上限 ${limit}）`
    else if (sources.has(key) && collisionKey(m.from) !== key)
      m.conflict = '目标是计划里另一项的原位置'
    else if (collisionKey(m.from) !== key && (await exists(m.to)))
      m.conflict = '目标已存在'
    taken.set(key, m)
    if (!m.conflict) {
      // 比较两边所在目录（overlayfs 等对文件与目录报不同的设备号）；只是提示，执行时以 EXDEV 为准
      const [a, b] = await Promise.all([
        deviceOf(dirname(m.from)),
        deviceOf(dirname(m.to)),
      ])
      m.crossDevice = a !== undefined && b !== undefined && a !== b
    }
  }
  // 视频有冲突时，同条目的旁挂与文件夹级文件都不动（否则字幕会和视频分开）
  const blocked = new Set(
    moves.filter(m => m.kind === 'video' && m.conflict).map(m => m.itemId)
  )
  for (const m of moves) {
    if (m.kind !== 'video' && !m.conflict && blocked.has(m.itemId)) {
      m.conflict = '同条目的视频有冲突，暂不移动'
    }
  }
  return { moves, unchanged }
}
