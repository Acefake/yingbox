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
import { dirname, extname, join, relative, sep } from 'node:path'
import type {
  LibraryItemNode,
  OrganizeEntry,
  WriterSettings,
} from '../../../../shared/library/ipc'
import type { LibraryRecord } from '../../libraries/library-store'
import { VIDEO_EXTENSIONS } from '../../scanner/rules'
import { ownerFolderDepth } from '../../../../shared/library/parser'
import { exists } from '../fs/file-ops'
import {
  type VideoTarget,
  blockWithConflictingVideo,
  movieTargets,
  seriesBase,
  seriesTargets,
  sidecarOwner,
  stem,
} from './organize-targets'

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
  const videoPaths = new Set(itemVideos)

  // 只有能确认目录树里的视频都属于当前条目，才能移动目录级附属内容。
  const ownsFolder = async (dir: string): Promise<boolean> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) return false
      if (entry.isDirectory() && !(await ownsFolder(path))) return false
      if (entry.isFile() && isVideo(entry.name) && !videoPaths.has(path))
        return false
    }
    return true
  }

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
      const best = sidecarOwner(entry.name, owners)
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
    const seriesDirOf = (file: string): string | null => {
      const folders = relative(root, dirname(file)).split(sep).filter(Boolean)
      const depth = ownerFolderDepth(folders)
      return depth ? join(root, ...folders.slice(0, depth)) : null
    }
    const groups = new Map<string, Set<string>>()
    for (const target of resolved) {
      const oldDir = seriesDirOf(target.from)
      const base = seriesBase(root, target.from)
      const segment = relative(base, target.to).split(sep)[0]
      if (!oldDir || dirname(target.to) === base) continue
      const destinations = groups.get(oldDir) ?? new Set<string>()
      destinations.add(join(base, segment))
      groups.set(oldDir, destinations)
    }
    // 季文件夹先处理（它们在剧集文件夹里，要整体挪走的话不能被当成剧集级目录）
    for (const [dir, list] of byDir) {
      const seriesDir = seriesDirOf(list[0].from)
      if (!seriesDir) continue
      if (dir === seriesDir || dirname(dir) !== seriesDir) continue
      const newDir = oneDir(list.filter(t => t.to).map(t => t.to!))
      if (newDir && newDir !== seriesDir && (await ownsFolder(dir)))
        await moveFolder(dir, newDir)
    }
    for (const [oldDir, destinations] of groups) {
      if (destinations.size === 1 && (await ownsFolder(oldDir)))
        await moveFolder(oldDir, [...destinations][0])
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
  blockWithConflictingVideo(moves)
  return { moves, unchanged }
}
