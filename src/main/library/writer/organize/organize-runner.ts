/**
 * 整理的执行与撤销：按批次日志逐项移动，每移完一项就在同一事务里更新 files 表与日志状态。
 *
 * 幂等：中途崩溃或被取消后重跑，已完成的项跳过；源不在而目标在的项视为已完成（移动做完、
 * 日志没来得及写）。撤销按 seq 倒序把已完成的项移回原处。
 * 执行期间持有涉及媒体库的扫描锁，扫描不会拿着旧快照把刚移动的文件当成删除 + 新增。
 */
import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { dirname, sep } from 'node:path'
import { type LibraryDb, transaction } from '../../db/database'
import type { KeyedMutex } from '../../jobs/keyed-mutex'
import type { LibraryRecord } from '../../libraries/library-store'
import { type MoveOps, exists, movePath } from '../fs/file-ops'
import type { OrganizeOp, WriterStore } from '../writer-store'
import { JUNK_RE } from './organize-planner'

/** 进度计数。 */
export interface OrganizeCounts {
  total: number
  done: number
  moved: number
  skipped: number
  failed: number
  lastError?: string
}

/** 依赖。 */
export interface OrganizeRunnerDeps {
  db: LibraryDb
  store: WriterStore
  locks: KeyedMutex<number>
  library(id: number): LibraryRecord
  /** 底层 rename（测试注入以模拟跨盘）。 */
  moveOps?: MoveOps
  now?: () => number
}

/** 在多个媒体库的锁内执行（按 id 排序加锁，避免互相等待）。 */
async function withLocks<T>(
  locks: KeyedMutex<number>,
  ids: number[],
  fn: () => Promise<T>
): Promise<T> {
  const [first, ...rest] = [...new Set(ids)].sort((a, b) => a - b)
  if (first === undefined) return fn()
  return locks.run(first, () => withLocks(locks, rest, fn))
}

/**
 * 删掉因移动而变空的目录（只含系统垃圾文件的也算空），逐级向上，到媒体库根目录为止。
 */
async function removeEmptyDirs(
  dirs: Iterable<string>,
  roots: string[]
): Promise<void> {
  const insideRoot = (dir: string): boolean =>
    roots.some(r => dir !== r && dir.startsWith(r + sep))
  const sorted = [...new Set(dirs)].sort((a, b) => b.length - a.length)
  for (const start of sorted) {
    let dir = start
    while (insideRoot(dir)) {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        dir = dirname(dir)
        continue
      }
      if (names.some(n => !JUNK_RE.test(n))) break
      try {
        for (const n of names)
          await rm(`${dir}${sep}${n}`, { recursive: true, force: true })
        await rmdir(dir)
      } catch {
        break
      }
      dir = dirname(dir)
    }
  }
}

/** 整理执行器。 */
export class OrganizeRunner {
  private readonly now: () => number

  constructor(private readonly deps: OrganizeRunnerDeps) {
    this.now = deps.now ?? Date.now
  }

  /** 执行批次里待执行的项。 */
  async apply(
    batchId: number,
    signal: AbortSignal,
    onProgress: (c: OrganizeCounts) => void
  ): Promise<OrganizeCounts> {
    const ops = this.deps.store.ops(batchId)
    return this.run(ops, 'apply', batchId, signal, onProgress)
  }

  /** 撤销：把已完成的项倒序移回。 */
  async undo(
    batchId: number,
    signal: AbortSignal,
    onProgress: (c: OrganizeCounts) => void
  ): Promise<OrganizeCounts> {
    const ops = this.deps.store.ops(batchId).reverse()
    return this.run(ops, 'undo', batchId, signal, onProgress)
  }

  private async run(
    ops: OrganizeOp[],
    direction: 'apply' | 'undo',
    batchId: number,
    signal: AbortSignal,
    onProgress: (c: OrganizeCounts) => void
  ): Promise<OrganizeCounts> {
    const todo = ops.filter(
      op => op.state === (direction === 'apply' ? 'pending' : 'done')
    )
    const counts: OrganizeCounts = {
      total: todo.length,
      done: 0,
      moved: 0,
      skipped: 0,
      failed: 0,
    }
    const libraries = [...new Set(todo.map(op => op.libraryId))]
    const touchedDirs: string[] = []
    await withLocks(this.deps.locks, libraries, async () => {
      for (const op of todo) {
        signal.throwIfAborted()
        const [from, to] =
          direction === 'apply' ? [op.src, op.dst] : [op.dst, op.src]
        const doneState = direction === 'apply' ? 'done' : 'undone'
        try {
          await this.moveOne(op, from, to)
          transaction(this.deps.db, () =>
            this.deps.store.setOpState(batchId, op.seq, doneState)
          )
          touchedDirs.push(dirname(from))
          counts.moved++
        } catch (error) {
          const message = (error as Error).message
          const state = direction === 'apply' ? 'failed' : 'done'
          this.deps.store.setOpState(batchId, op.seq, state, message)
          counts.failed++
          counts.lastError = `${from}：${message}`
        }
        counts.done++
        onProgress(counts)
      }
      await removeEmptyDirs(
        touchedDirs,
        libraries.map(id => this.deps.library(id).root)
      )
    })
    return counts
  }

  /** 移动一项并同步数据库；源不在而目标在时视为已经移过。 */
  private async moveOne(
    op: OrganizeOp,
    from: string,
    to: string
  ): Promise<void> {
    if (!(await exists(from))) {
      if (await exists(to)) {
        await this.syncDb(op, from, to)
        return
      }
      throw new Error('源文件不存在')
    }
    await movePath(from, to, this.deps.moveOps)
    await this.syncDb(op, from, to)
  }

  /** 按移动后的实际状态更新 files 表（大小 / mtime 以新文件为准）。 */
  private async syncDb(
    op: OrganizeOp,
    from: string,
    to: string
  ): Promise<void> {
    const s = await lstat(to)
    const library = this.deps.library(op.libraryId)
    transaction(this.deps.db, () =>
      this.deps.store.relocate(
        library,
        from,
        to,
        s.isDirectory(),
        s.isDirectory() ? null : { size: s.size, mtime: s.mtimeMs },
        this.now()
      )
    )
  }
}
