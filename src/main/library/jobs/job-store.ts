/**
 * 任务持久化：jobs 表。排队中的同 key 任务只保留一条（入队时合并载荷），
 * 引擎重启后把“运行中”恢复成“排队”，从而断点续跑。
 */
import type { ActiveLibraryJob, JobState } from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache, transaction } from '../db/database'

/** 一条任务记录。 */
export interface JobRecord {
  id: number
  type: string
  /** 去重 / 互斥键：同 key 的任务排队时合并，运行时互斥。 */
  key: string | null
  payload: unknown
  priority: number
  state: JobState
  attempts: number
  maxAttempts: number
  /** 毫秒时间戳，早于它不执行（重试退避）。 */
  runAfter: number
  lastError: string | null
}

/** 入队参数。 */
export interface JobSpec {
  type: string
  payload: unknown
  key?: string
  /** 越大越先执行，默认 0。 */
  priority?: number
  /** 默认 3。 */
  maxAttempts?: number
}

/** 已有同 key 排队任务时，如何合并载荷。 */
export type PayloadMerger = (existing: unknown, incoming: unknown) => unknown

function toRecord(row: Record<string, unknown>): JobRecord {
  return {
    id: Number(row.id),
    type: String(row.type),
    key: row.key === null ? null : String(row.key),
    payload: JSON.parse(String(row.payload)),
    priority: Number(row.priority),
    state: row.state as JobState,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: Number(row.run_after),
    lastError: row.last_error === null ? null : String(row.last_error),
  }
}

/** 任务仓库。 */
export class JobStore {
  private readonly sql: StatementCache

  constructor(private readonly db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 读取当前任务，不暴露任务载荷中的其他数据。 */
  activeJobs(): ActiveLibraryJob[] {
    return this.sql
      .get(
        "SELECT id, type, state, payload FROM jobs WHERE state IN ('queued', 'running') ORDER BY id"
      )
      .all()
      .map(row => {
        const payload = JSON.parse(String(row.payload)) as Record<
          string,
          unknown
        > | null
        return {
          jobId: Number(row.id),
          jobType: String(row.type),
          state: row.state as 'queued' | 'running',
          libraryId:
            typeof payload?.libraryId === 'number' ? payload.libraryId : null,
          batchId:
            typeof payload?.batchId === 'number' ? payload.batchId : null,
        }
      })
  }

  /** 按 id 取。 */
  get(id: number): JobRecord | undefined {
    const row = this.sql.get('SELECT * FROM jobs WHERE id = ?').get(id)
    return row ? toRecord(row) : undefined
  }

  /**
   * 入队。已有同 key 的排队任务时合并进去（载荷用 merge 合并，优先级取较大值），
   * 返回合并后的那条，不新建。
   */
  enqueue(spec: JobSpec, now: number, merge?: PayloadMerger): JobRecord {
    return transaction(this.db, () => {
      if (spec.key !== undefined) {
        const row = this.sql
          .get("SELECT * FROM jobs WHERE key = ? AND state = 'queued'")
          .get(spec.key)
        if (row) {
          const existing = toRecord(row)
          const payload = merge
            ? merge(existing.payload, spec.payload)
            : spec.payload
          this.sql
            .get(
              'UPDATE jobs SET payload = ?, priority = MAX(priority, ?), updated_at = ? WHERE id = ?'
            )
            .run(JSON.stringify(payload), spec.priority ?? 0, now, existing.id)
          return this.get(existing.id)!
        }
      }
      const inserted = this.sql
        .get(
          `INSERT INTO jobs (type, key, payload, priority, state, max_attempts,
             run_after, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?) RETURNING id`
        )
        .get(
          spec.type,
          spec.key ?? null,
          JSON.stringify(spec.payload ?? null),
          spec.priority ?? 0,
          spec.maxAttempts ?? 3,
          now,
          now
        )!
      return this.get(Number(inserted.id))!
    })
  }

  /**
   * 取下一条可执行的任务并标记为运行中：已到 run_after、key 不与运行中的任务冲突，
   * 优先级高的先，同优先级先进先出。没有时返回 undefined。
   */
  claimNext(now: number, busyKeys: ReadonlySet<string>): JobRecord | undefined {
    const rows = this.sql
      .get(
        `SELECT * FROM jobs WHERE state = 'queued' AND run_after <= ?
         ORDER BY priority DESC, id`
      )
      .all(now)
    for (const row of rows) {
      const job = toRecord(row)
      if (job.key !== null && busyKeys.has(job.key)) continue
      this.sql
        .get(
          "UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?"
        )
        .run(now, job.id)
      return { ...job, state: 'running', attempts: job.attempts + 1 }
    }
    return undefined
  }

  /** 最早的未来 run_after（用于定时唤醒）；没有等待中的任务返回 undefined。 */
  nextRunAfter(now: number): number | undefined {
    const row = this.sql
      .get(
        "SELECT MIN(run_after) AS t FROM jobs WHERE state = 'queued' AND run_after > ?"
      )
      .get(now)
    return row?.t === null || row?.t === undefined ? undefined : Number(row.t)
  }

  /** 结束一条任务（完成 / 失败 / 取消）。 */
  finish(
    id: number,
    state: Extract<JobState, 'done' | 'failed' | 'cancelled'>,
    now: number,
    error?: string
  ): void {
    this.sql
      .get(
        'UPDATE jobs SET state = ?, last_error = ?, updated_at = ? WHERE id = ?'
      )
      .run(state, error ?? null, now, id)
  }

  /** 失败后重新排队，runAfter 之后再试。 */
  retry(id: number, runAfter: number, now: number, error: string): void {
    this.sql
      .get(
        "UPDATE jobs SET state = 'queued', run_after = ?, last_error = ?, updated_at = ? WHERE id = ?"
      )
      .run(runAfter, error, now, id)
  }

  /**
   * 引擎启动时调用：上次没跑完的任务恢复成排队，返回恢复的条数。
   * 若同 key 已有排队任务，被中断的那条直接取消（排队的那条会覆盖它的工作）。
   */
  recoverInterrupted(now: number): number {
    return transaction(this.db, () => {
      this.sql
        .get(
          `UPDATE jobs SET state = 'cancelled', updated_at = ?
           WHERE state = 'running' AND key IN (SELECT key FROM jobs WHERE state = 'queued')`
        )
        .run(now)
      return Number(
        this.sql
          .get(
            "UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'running'"
          )
          .run(now).changes
      )
    })
  }

  /** 取消排队中的任务；返回是否取消成功。 */
  cancelQueued(id: number, now: number): boolean {
    return (
      this.sql
        .get(
          "UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE id = ? AND state = 'queued'"
        )
        .run(now, id).changes > 0
    )
  }

  /** 删除早于 before 的已结束任务，防止表无限增长。 */
  prune(before: number): void {
    this.sql
      .get(
        "DELETE FROM jobs WHERE state IN ('done', 'failed', 'cancelled') AND updated_at < ?"
      )
      .run(before)
  }
}
