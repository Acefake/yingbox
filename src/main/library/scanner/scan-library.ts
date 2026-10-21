/**
 * 一次媒体库扫描：遍历得到差异 → 识别移动 → 分批事务写回 dirs / files / 条目关联。
 *
 * 写回顺序保证崩溃后重跑能收敛到同一结果：
 * 1. 第一个事务处理移动和删除（需要全局视图）；
 * 2. 之后每批若干目录一个事务，目录的 mtime 与它的文件变化在同一事务里提交——
 *    没提交的目录下次 mtime 不匹配，会被重新读取，所以中断的扫描重跑时从断点继续；
 * 3. 最后回收空条目、记录扫描时间。
 * 批与批之间让出事件循环，扫描期间查询照常响应。
 *
 * 写入稳定判定（可选，见 settle.ts）：还在复制中的视频这一轮不写，所在目录记不可信 mtime，
 * 摘要里给出这些目录和建议的复查时间，由服务层排一次定向复扫。移动识别在判定之前做：
 * 同盘改名是原子的，不需要等。
 */
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { type LibraryDb, transaction } from '../db/database'
import { CatalogStore, ItemChanges } from '../catalog/catalog-store'
import type { LibraryRecord } from '../libraries/library-store'
import { type FileMove, type Fingerprinter, detectMoves } from './moves'
import { type ParseContext, parseLibraryFile } from './parse'
import type { ScanStore } from './scan-store'
import type { SettleTracker } from './settle'
import type { DirChange, ScanDiff, ScannedFile, StoredFile } from './types'
import { RACY_MTIME, walkLibrary } from './walk'

/** 扫描参数。 */
export interface ScanOptions {
  full?: boolean
  /** 只重读这些目录（来自文件监听）。 */
  scope?: string[]
  signal?: AbortSignal
  /** 每个事务最多写多少个文件，默认 2000。 */
  batchSize?: number
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
  const batchSize = options.batchSize ?? 2000
  const { db, scanStore, catalog } = deps
  const ctx: ParseContext = {
    libraryId: library.id,
    kind: library.kind,
    rootKey: library.rootKey,
    source: library.source,
  }

  const t0 = performance.now()
  const diff = await walkLibrary(library.root, scanStore.snapshot(library.id), {
    full: options.full,
    scope: options.scope,
    signal: options.signal,
    racyWindowMs: options.racyWindowMs,
  })
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

  // 1) 移动与删除
  transaction(db, () => {
    const at = now()
    for (const move of moves) {
      // 保留原记录（id、关联、匹配）；路径变了重新解析，但不改关联
      const { columns } = parseLibraryFile(ctx, move.to)
      scanStore.updateFile(
        move.from.id,
        move.to,
        columns,
        at,
        move.fingerprint ?? move.from.fingerprint
      )
    }
    for (const file of removedFiles) {
      if (movedFrom.has(file.id)) continue
      for (const id of catalog.topLevelOfFile(file.id)) changes.touch(id)
      scanStore.deleteFile(file.id)
      removed++
      needsGc = true
    }
    for (const dir of diff.removedDirs) scanStore.deleteSubtree(dir.key)
  })

  // 2) 按目录分批写入新增与变更
  let added = 0
  let changed = 0
  const total = diff.dirChanges.reduce(
    (n, c) => n + c.added.length + c.changed.length,
    0
  )
  let index = 0
  while (index < diff.dirChanges.length) {
    options.signal?.throwIfAborted()
    transaction(db, () => {
      const at = now()
      let written = 0
      while (index < diff.dirChanges.length && written < batchSize) {
        const change = diff.dirChanges[index++]
        scanStore.upsertDir(library.id, change.dir)
        for (const file of change.added) {
          if (movedTo.has(file.key)) continue
          const parse = parseLibraryFile(ctx, file)
          const id = scanStore.insertFile(library.id, file, parse.columns, at)
          catalog.linkFile(library.id, id, parse.grouping, true, at, changes)
          added++
        }
        for (const file of change.changed) {
          const parse = parseLibraryFile(ctx, file)
          scanStore.updateFile(file.id, file, parse.columns, at, null)
          if (
            catalog.linkFile(
              library.id,
              file.id,
              parse.grouping,
              false,
              at,
              changes
            )
          ) {
            needsGc = true
          }
          changed++
        }
        written += change.added.length + change.changed.length + 1
      }
    })
    options.onProgress?.(total ? (added + changed) / total : 1)
    await yieldToLoop()
  }

  // 3) 回收空条目、记录变化时间
  transaction(db, () => {
    const at = now()
    if (needsGc) catalog.collectGarbage(library.id, changes)
    catalog.bumpUpdated(changes, at)
  })
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
