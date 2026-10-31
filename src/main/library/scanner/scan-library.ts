/**
 * 一次媒体库扫描：遍历得到差异 → 识别移动 → 分批事务写回 dirs / files / 条目关联。
 * 本地目录用 walk.ts 遍历，远程源（WebDAV / Alist）用 remote-walk.ts，差异形状相同，之后的步骤共用。
 *
 * 写回顺序保证崩溃后重跑能收敛到同一结果：
 * 1. 第一个事务处理移动和删除（需要全局视图）；
 * 2. 之后按时间片分事务写入（每片默认 ≤SCAN_SLICE_MS，大目录也会被切开），目录的真实 mtime
 *    与它的最后一个文件在同一事务里提交，写到一半的目录记不可信 mtime——
 *    没写完的目录下次 mtime 不匹配，会被重新读取，所以中断的扫描重跑时从断点继续；
 * 3. 最后回收空条目、记录扫描时间。
 * 片与片之间让出事件循环，扫描期间查询、事件照常响应（同步的 node:sqlite 不会长时间独占线程）。
 *
 * 写入稳定判定（可选，见 settle.ts）：还在复制中的视频这一轮不写，所在目录记不可信 mtime，
 * 摘要里给出这些目录和建议的复查时间，由服务层排一次定向复扫。移动识别在判定之前做：
 * 同盘改名是原子的，不需要等。
 */
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import type { DavClient } from '../../../shared/webdav/client'
import { parseRemotePath } from '../../../shared/webdav/remote-path'
import { type LibraryDb, transaction } from '../db/database'
import { CatalogStore, ItemChanges } from '../catalog/catalog-store'
import type { LibraryRecord } from '../libraries/library-store'
import { type FileMove, type Fingerprinter, detectMoves } from './moves'
import { type ParseContext, parseLibraryFile } from './parse'
import type { ScanStore } from './scan-store'
import type { SettleTracker } from './settle'
import { walkRemoteLibrary } from './remote-walk'
import type {
  DirChange,
  ScanDiff,
  ScanSnapshot,
  ScannedFile,
  StoredFile,
} from './types'
import { RACY_MTIME, SCAN_SLICE_MS, walkLibrary } from './walk'

/** 扫描参数。 */
export interface ScanOptions {
  full?: boolean
  /** 只重读这些目录（来自文件监听）。 */
  scope?: string[]
  signal?: AbortSignal
  /**
   * 每个写事务最多占用事件循环多久（毫秒），默认 SCAN_SLICE_MS；到点在文件边界提交并让出。
   * 0 表示每个事务只写一个文件（测试用）。
   */
  sliceMs?: number
  /** 进度回调，0–1。 */
  onProgress?: (fraction: number) => void
  /** 时钟，测试注入。 */
  now?: () => number
  /** 见 WalkOptions.racyWindowMs。 */
  racyWindowMs?: number
  /** 写入稳定判定；缺省时所有文件立即入库。initial 为媒体库首扫（见 SettleTracker.check）。 */
  settle?: { tracker: SettleTracker; initial: boolean }
}

/** 这一轮因为还在写入而没有入库的文件所在目录。 */
export interface UnsettledFiles {
  /** 目录（原始路径），用于定向复扫。 */
  dirs: string[]
  /** 建议多久后复扫。 */
  retryInMs: number
}

/** 扫描依赖。 */
export interface ScanDeps {
  db: LibraryDb
  scanStore: ScanStore
  catalog: CatalogStore
  fingerprint: Fingerprinter
  /** 远程源（WebDAV）的客户端；没有时远程媒体库扫描报错。 */
  remote?: RemoteClients
}

/** 按源 id 取 WebDAV 客户端（源不存在时抛错）。 */
export type RemoteClients = (sourceId: string) => Promise<DavClient>

/** 遍历媒体库：本地目录走 walk.ts，远程源走 remote-walk.ts。 */
async function walkAny(
  deps: ScanDeps,
  library: LibraryRecord,
  snapshot: ScanSnapshot,
  options: ScanOptions
): Promise<ScanDiff> {
  const walkOptions = {
    full: options.full,
    scope: options.scope,
    signal: options.signal,
    racyWindowMs: options.racyWindowMs,
    sliceMs: options.sliceMs,
  }
  const remote = parseRemotePath(library.root)
  if (!remote) return walkLibrary(library.root, snapshot, walkOptions)
  if (!deps.remote) throw new Error('这里不支持 WebDAV 媒体库')
  const client = await deps.remote(remote.sourceId)
  return walkRemoteLibrary(library.root, snapshot, client, walkOptions)
}

/** 扫描结果摘要。 */
export interface ScanSummary {
  added: number
  changed: number
  removed: number
  moved: FileMove[]
  changes: ItemChanges
  warnings: string[]
  stats: ScanDiff['stats']
  /** 各阶段耗时（毫秒）。 */
  timings: { walk: number; moves: number; write: number }
  /** 还在写入、这一轮没有入库的文件；没有时为 null。 */
  unsettled: UnsettledFiles | null
}

/**
 * 把还在写入的视频从差异里摘掉（改名移动的目标除外），所在目录记不可信 mtime，
 * 保证之后任何一次扫描都会重读它。
 */
function holdUnsettled(
  changes: DirChange[],
  movedTo: Set<string>,
  settle: NonNullable<ScanOptions['settle']>,
  at: number
): UnsettledFiles | null {
  const dirs = new Map<string, string>()
  let retryInMs = Infinity
  const held = (file: ScannedFile): boolean => {
    if (file.kind !== 'video' || movedTo.has(file.key)) return false
    const verdict = settle.tracker.check(file, at, settle.initial)
    if (verdict.stable) return false
    retryInMs = Math.min(retryInMs, verdict.retryInMs)
    return true
  }
  for (const change of changes) {
    const added = change.added.filter(f => !held(f))
    const changed = change.changed.filter(f => !held(f))
    if (
      added.length === change.added.length &&
      changed.length === change.changed.length
    ) {
      continue
    }
    change.added = added
    change.changed = changed
    change.dir.mtime = RACY_MTIME
    dirs.set(change.dir.key, change.dir.displayPath)
  }
  settle.tracker.prune(at)
  return dirs.size ? { dirs: [...dirs.values()], retryInMs } : null
}

/** 执行一次扫描。 */
export async function scanLibrary(
  deps: ScanDeps,
  library: LibraryRecord,
  options: ScanOptions = {}
): Promise<ScanSummary> {
  const now = options.now ?? Date.now
  const { db, scanStore, catalog } = deps
  const ctx: ParseContext = {
    libraryId: library.id,
    kind: library.kind,
    mixed: library.mixed,
    rootKey: library.rootKey,
    source: library.source,
  }

  const t0 = performance.now()
  const diff = await walkAny(
    deps,
    library,
    scanStore.snapshot(library.id),
    options
  )
  const t1 = performance.now()

  const removedFiles: StoredFile[] = []
  for (const change of diff.dirChanges) removedFiles.push(...change.removed)
  for (const dir of diff.removedDirs) removedFiles.push(...dir.files)
  const addedFiles = diff.dirChanges.flatMap(c => c.added)
  const moves = await detectMoves(removedFiles, addedFiles, deps.fingerprint)
  const t2 = performance.now()
  options.signal?.throwIfAborted()

  const changes = new ItemChanges()
  const movedFrom = new Set(moves.map(m => m.from.id))
  const movedTo = new Set(moves.map(m => m.to.key))
  const unsettled = options.settle
    ? holdUnsettled(diff.dirChanges, movedTo, options.settle, now())
    : null
  let needsGc = false
  let removed = 0

  const sliceMs = options.sliceMs ?? SCAN_SLICE_MS
  /**
   * 按时间片分事务执行：每个事务里反复调用 step（返回 false 表示做完），
   * 占用超过 sliceMs 就提交、让出事件循环再继续。endSlice 在每个事务提交前调用，
   * afterSlice 在提交后调用；给了 signal 时每片开始前检查取消。
   */
  const inSlices = async (
    step: () => boolean,
    hooks: {
      endSlice?: () => void
      afterSlice?: () => void
      signal?: AbortSignal
    } = {}
  ): Promise<void> => {
    const { endSlice, afterSlice, signal } = hooks
    let more = true
    while (more) {
      signal?.throwIfAborted()
      transaction(db, () => {
        const deadline = performance.now() + sliceMs
        do more = step()
        while (more && performance.now() < deadline)
        endSlice?.()
      })
      afterSlice?.()
      if (more) await yieldToLoop()
    }
  }

  // 1) 移动与删除。可以分片：没删完的文件所在目录的 mtime 要到第 2 步才更新，
  //    中断后重扫会重读这些目录、再次认出删除和移动
  const removals: Array<() => void> = []
  for (const move of moves) {
    removals.push(() => {
      // 保留原记录（id、关联、匹配）；路径变了重新解析，但不改关联
      const { columns } = parseLibraryFile(
        { ...ctx, overrideKind: scanStore.mediaKindOverride(move.from.id) },
        move.to
      )
      scanStore.updateFile(
        move.from.id,
        move.to,
        columns,
        now(),
        move.fingerprint ?? move.from.fingerprint
      )
    })
  }
  for (const file of removedFiles) {
    if (movedFrom.has(file.id)) continue
    removals.push(() => {
      for (const id of catalog.topLevelOfFile(file.id)) changes.touch(id)
      scanStore.deleteFile(file.id)
      removed++
      needsGc = true
    })
  }
  for (const dir of diff.removedDirs) {
    removals.push(() => scanStore.deleteSubtree(dir.key))
  }
  let removalIndex = 0
  if (removals.length) {
    await inSlices(
      () => {
        removals[removalIndex++]()
        return removalIndex < removals.length
      },
      { signal: options.signal }
    )
  }

  // 2) 新增与变更。目录的真实 mtime 只和它的最后一个文件同事务提交；写到一半的目录
  //    先记不可信 mtime，中断后重扫会重读它，已写入的文件与磁盘一致、不会重复
  let added = 0
  let changed = 0
  const total = diff.dirChanges.reduce(
    (n, c) => n + c.added.length + c.changed.length,
    0
  )
  /** 写一个新增文件（移动目标已在第 1 步更新过，跳过）。 */
  const writeAdded = (file: ScannedFile): void => {
    if (movedTo.has(file.key)) return
    const at = now()
    const parse = parseLibraryFile(ctx, file)
    const id = scanStore.insertFile(library.id, file, parse.columns, at)
    catalog.linkFile(library.id, id, parse.grouping, true, at, changes)
    added++
  }
  /** 写一个变更文件：重新解析，关联变了需要回收空条目。 */
  const writeChanged = (file: DirChange['changed'][number]): void => {
    const at = now()
    const overrideKind = scanStore.mediaKindOverride(file.id)
    const parse = parseLibraryFile({ ...ctx, overrideKind }, file)
    scanStore.updateFile(file.id, file, parse.columns, at, null)
    const existing = overrideKind ? catalog.topLevelOfFile(file.id) : []
    for (const id of existing) changes.touch(id)
    if (
      !existing.length &&
      catalog.linkFile(library.id, file.id, parse.grouping, false, at, changes)
    ) {
      needsGc = true
    }
    changed++
  }
  let dirIndex = 0
  /** 当前目录里已写到第几个文件（先新增、后变更）。 */
  let fileIndex = 0
  if (diff.dirChanges.length) {
    await inSlices(
      () => {
        const change = diff.dirChanges[dirIndex]
        const count = change.added.length + change.changed.length
        if (fileIndex < count) {
          if (fileIndex < change.added.length) {
            writeAdded(change.added[fileIndex])
          } else {
            writeChanged(change.changed[fileIndex - change.added.length])
          }
          fileIndex++
        }
        if (fileIndex >= count) {
          scanStore.upsertDir(library.id, change.dir)
          dirIndex++
          fileIndex = 0
        }
        return dirIndex < diff.dirChanges.length
      },
      {
        endSlice: () => {
          if (fileIndex > 0) {
            const partial = diff.dirChanges[dirIndex].dir
            scanStore.upsertDir(library.id, { ...partial, mtime: RACY_MTIME })
          }
        },
        afterSlice: () =>
          options.onProgress?.(total ? (added + changed) / total : 1),
        signal: options.signal,
      }
    )
  }

  // 3) 回收空条目（分块分片；不响应取消：文件已删，它们的空条目必须回收完）、记录变化时间
  if (needsGc) {
    const chunks = catalog.garbageChunks(library.id, changes)
    await inSlices(() => !chunks.next().done)
  }
  transaction(db, () => catalog.bumpUpdated(changes, now()))
  const t3 = performance.now()

  return {
    added,
    changed,
    removed,
    moved: moves,
    changes,
    warnings: diff.warnings,
    stats: diff.stats,
    timings: { walk: t1 - t0, moves: t2 - t1, write: t3 - t2 },
    unsettled,
  }
}
