/**
 * 增量遍历：对照数据库快照走一遍磁盘，只产出差异（新增 / 变更 / 删除），不产出全量列表。
 *
 * 短路规则与修好的 media-scanner 相同：目录 mtime 未变 → 它的直接子项列表没变，跳过
 * readdir 和文件 stat；子目录照常逐个 stat、各自判断，因为目录 mtime 不反映孙子层变化。
 * 无变化重扫因此只 stat 全部目录，不读任何文件，也不产生任何写入。
 *
 * 安全规则：根目录读不到直接抛错（NAS 掉线不能当成“全删了”）；非根目录 readdir 失败
 * 时既不复用也不删除，原样保留数据库里的旧记录。
 */
import type { Dirent, Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { fileKindOf, isIgnoredName, parentKey, pathKey } from './rules'
import type {
  DirChange,
  ScanDiff,
  ScanSnapshot,
  ScannedFile,
  StoredDir,
} from './types'

/** 遍历参数。 */
export interface WalkOptions {
  /** 不走 mtime 短路，所有目录都 readdir、所有文件都 stat。 */
  full?: boolean
  /**
   * 只重读这些目录（监听事件涉及的目录）：强制 readdir，新出现的子目录完整下钻，
   * 已知子目录不下钻。缺省时从根目录完整遍历。
   */
  scope?: string[]
  /** 同时处理的目录数，默认 16。 */
  concurrency?: number
  /** 中途取消。 */
  signal?: AbortSignal
  /**
   * “太新”的目录 mtime 不可信的时间窗（毫秒），默认 3000。
   * 文件系统时间戳有粒度（内核粗粒度时钟、FAT/SMB 2 秒），扫描时刚被改过的目录，
   * 之后同一时间片内的再次改动不会改变 mtime。这类目录记一个哨兵值，下次扫描强制重读。
   */
  racyWindowMs?: number
  /** 同步读库最多连续占用事件循环多久（毫秒），默认 SCAN_SLICE_MS。 */
  sliceMs?: number
}

/** 不可信 mtime 的哨兵值：任何真实 mtime 都不等于它，下次必然重读。 */
export const RACY_MTIME = -1

/**
 * 扫描时同步读写库一次最多连续占用事件循环多久（毫秒）。node:sqlite 是同步 API，
 * 到点就提交 / 让出一次。16 ms 下 5 万文件冷扫最长卡顿 <50 ms，CPU 只多约一成；
 * 8 ms 时提交次数翻倍，热点索引页反复写 WAL，CPU 多两三成。
 */
export const SCAN_SLICE_MS = 16

/** readdir 得到的一个目录的直接内容。 */
interface Listing {
  subdirs: string[]
  files: ScannedFile[]
}

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT'

/** 列出目录的收录项并 stat 其中的文件。 */
async function listDirectory(
  directory: string,
  key: string,
  warnings: string[]
): Promise<Listing> {
  const entries: Dirent[] = await readdir(directory, { withFileTypes: true })
  const subdirs: string[] = []
  const pending: Array<Promise<ScannedFile | undefined>> = []
  for (const entry of entries) {
    const lower = entry.name.toLowerCase()
    if (isIgnoredName(lower) || entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      subdirs.push(join(directory, entry.name))
      continue
    }
    const kind = entry.isFile() ? fileKindOf(lower) : undefined
    if (!kind) continue
    const displayPath = join(directory, entry.name)
    pending.push(
      stat(displayPath).then(
        (s): ScannedFile => ({
          key: pathKey(displayPath),
          displayPath,
          dir: key,
          name: entry.name,
          kind,
          size: s.size,
          mtime: s.mtimeMs,
        }),
        error => {
          if (!isMissing(error)) {
            warnings.push(`${displayPath}: ${(error as Error).message}`)
          }
          return undefined
        }
      )
    )
  }
  const files = (await Promise.all(pending)).filter(
    (f): f is ScannedFile => f !== undefined
  )
  return { subdirs, files }
}

/**
 * 对照快照遍历媒体库根目录，返回差异。
 * 根目录本身也记一条目录记录（parent 为 null），这样根目录的 mtime 也参与下次比较。
 */
export async function walkLibrary(
  root: string,
  snapshot: ScanSnapshot,
  options: WalkOptions = {}
): Promise<ScanDiff> {
  const rootPath = resolve(root)
  const rootKey = pathKey(rootPath)
  const full = options.full ?? false
  const racyBefore = Date.now() - (options.racyWindowMs ?? 3000)
  const diff: ScanDiff = {
    dirChanges: [],
    removedDirs: [],
    warnings: [],
    stats: { dirsVisited: 0, dirsReused: 0, filesStatted: 0 },
  }
  const visited = new Set<string>()

  /** 根据 readdir 结果对比快照，记录差异，返回需要继续下钻的子目录。 */
  const diffDirectory = (
    displayPath: string,
    key: string,
    dirStats: Stats,
    listing: Listing,
    prev: StoredDir | undefined,
    descendKnown: boolean
  ): string[] => {
    diff.stats.filesStatted += listing.files.length
    const oldFiles = new Map(snapshot.filesIn(key).map(f => [f.key, f]))
    const change: DirChange = {
      dir: {
        key,
        displayPath,
        parent: key === rootKey ? null : parentKey(key),
        mtime: dirStats.mtimeMs > racyBefore ? RACY_MTIME : dirStats.mtimeMs,
      },
      added: [],
      changed: [],
      removed: [],
    }
    for (const file of listing.files) {
      const old = oldFiles.get(file.key)
      if (!old) change.added.push(file)
      else {
        oldFiles.delete(file.key)
        if (old.size !== file.size || old.mtime !== file.mtime) {
          change.changed.push({ ...file, id: old.id })
        }
      }
    }
    change.removed.push(...oldFiles.values())

    const known = new Map(snapshot.childDirs(key).map(d => [d.key, d]))
    const next: string[] = []
    for (const sub of listing.subdirs) {
      const subKey = pathKey(sub)
      const wasKnown = known.delete(subKey)
      if (!wasKnown || descendKnown) next.push(sub)
    }
    // 子树里的文件遍历完再分片读（一次删掉几百个目录时，同步全读会卡住事件循环）
    for (const gone of known.values()) {
      diff.removedDirs.push({ key: gone.key, files: [] })
    }

    const unchanged =
      prev?.mtime === change.dir.mtime &&
      change.added.length === 0 &&
      change.changed.length === 0 &&
      change.removed.length === 0
    if (!unchanged) diff.dirChanges.push(change)
    return next
  }

  /**
   * 处理一个目录。force 时无视短路强制 readdir；descendKnown 为 false 时只下钻新子目录。
   * 返回需要继续处理的子目录。
   */
  const visit = async (
    displayPath: string,
    force: boolean,
    descendKnown: boolean
  ): Promise<string[]> => {
    const key = pathKey(displayPath)
    if (visited.has(key)) return []
    visited.add(key)
    let dirStats: Stats
    try {
      dirStats = await stat(displayPath)
    } catch (error) {
      if (key === rootKey) throw error
      // 已不存在：由父目录的 readdir 负责记为删除；其他错误只告警，保留旧记录
      if (!isMissing(error)) {
        diff.warnings.push(`${displayPath}: ${(error as Error).message}`)
      }
      return []
    }
    if (!dirStats.isDirectory()) return []
    diff.stats.dirsVisited++

    const prev = snapshot.getDir(key)
    if (!force && !full && prev && prev.mtime === dirStats.mtimeMs) {
      diff.stats.dirsReused++
      return descendKnown ? snapshot.childDirs(key).map(d => d.displayPath) : []
    }
    let listing: Listing
    try {
      listing = await listDirectory(displayPath, key, diff.warnings)
    } catch (error) {
      if (key === rootKey) throw error
      diff.warnings.push(`${displayPath}: ${(error as Error).message}`)
      return []
    }
    return diffDirectory(
      displayPath,
      key,
      dirStats,
      listing,
      prev,
      descendKnown
    )
  }

  /** 待处理目录：force 跳过短路，descendKnown 决定是否下钻已知子目录。 */
  type Task = { path: string; force: boolean; descendKnown: boolean }
  const queue: Task[] = []
  if (options.scope?.length) {
    for (const dir of options.scope) {
      const key = pathKey(resolve(dir))
      if (key === rootKey || key.startsWith(`${rootKey}/`)) {
        queue.push({ path: resolve(dir), force: true, descendKnown: false })
      }
    }
  } else {
    queue.push({ path: rootPath, force: true, descendKnown: true })
  }

  const concurrency = options.concurrency ?? 16
  await new Promise<void>((done, fail) => {
    let active = 0
    let failed = false
    const pump = (): void => {
      if (failed) return
      if (options.signal?.aborted) {
        failed = true
        fail(options.signal.reason)
        return
      }
      while (active < concurrency && queue.length) {
        const task = queue.pop()!
        active++
        visit(task.path, task.force, task.descendKnown).then(
          subdirs => {
            active--
            // 子目录：新目录完整下钻；完整遍历时已知目录也下钻（各自判断短路）
            for (const sub of subdirs) {
              queue.push({ path: sub, force: false, descendKnown: true })
            }
            pump()
          },
          error => {
            failed = true
            fail(error)
          }
        )
      }
      if (active === 0 && queue.length === 0) done()
    }
    pump()
  })

  const sliceMs = options.sliceMs ?? SCAN_SLICE_MS
  let deadline = performance.now() + sliceMs
  for (const gone of diff.removedDirs) {
    gone.files = snapshot.filesUnder(gone.key)
    if (performance.now() >= deadline) {
      await yieldToLoop()
      options.signal?.throwIfAborted()
      deadline = performance.now() + sliceMs
    }
  }
  return diff
}
