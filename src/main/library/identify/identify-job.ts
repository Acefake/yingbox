/**
 * identify 任务的执行：取目标 → （刷新时让缓存过期）→ 跑执行器，
 * 期间节流推送进度与条目变化（海报墙边识别边刷新），结束时交出有变化的条目（后继据此派发，见 identify-module）。
 */
import type { LibraryEvent } from '../../../shared/library/ipc'
import type { ItemChanges } from '../catalog/catalog-store'
import { type JobContext, PermanentJobError } from '../jobs/queue'
import type { SqliteResponseCache } from '../providers/http/provider-cache'
import { ProviderAuthError } from '../providers/http/provider-http'
import type { IdentifyRunner } from './identify-runner'
import {
  type IdentifyPayload,
  progressEvent,
  refreshCacheKeys,
  takeFreshChanges,
  targetScope,
} from './identify-rules'
import type { IdentifyStore } from './identify-store'
import type { RunSummary } from './runner-types'

/** 进度事件最小间隔。 */
export const PROGRESS_INTERVAL_MS = 250

/** 任务执行需要的模块能力。 */
export interface IdentifyJobDeps {
  store: IdentifyStore
  cache: SqliteResponseCache
  runner: IdentifyRunner
  emit: (event: LibraryEvent) => void
  /** 按媒体库拆分变化并推送 items-changed。 */
  emitChanges: (changes: ItemChanges) => void
  concurrency?: number
}

/** identify 任务的结果。 */
export interface IdentifyResult {
  /** 元数据有变化的顶层条目。 */
  changed: number[]
}

/** 执行一个 identify 任务。 */
export async function runIdentifyJob(
  deps: IdentifyJobDeps,
  payload: IdentifyPayload,
  ctx: JobContext
): Promise<IdentifyResult> {
  const mode = payload.mode
  const targets = deps.store.targets(targetScope(mode), {
    libraryId: payload.libraryId,
    itemIds: payload.itemIds,
  })
  if (mode === 'refresh') {
    // 让这些条目的缓存过期，走 ETag 条件请求拿最新数据
    deps.cache.expire(refreshCacheKeys(targets), Date.now())
  }
  let lastEmit = 0
  const progress = (
    summary: RunSummary,
    finished: boolean,
    error?: string
  ): void => {
    deps.emit(progressEvent(ctx.job.id, payload, summary, finished, error))
  }
  // 条目变化分段推送：海报墙边识别边刷新，每个 id 只推一次
  const emitted = new Set<number>()
  const flush = (all: ItemChanges): void => {
    deps.emitChanges(takeFreshChanges(all, emitted))
  }
  let summary: RunSummary | undefined
  try {
    summary = await deps.runner.run(targets, mode, {
      signal: ctx.signal,
      concurrency: deps.concurrency,
      onProgress: s => {
        summary = s
        ctx.progress(s.total ? s.done / s.total : 1)
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          progress(s, false)
          flush(s.changes)
        }
      },
    })
  } catch (error) {
    if (ctx.signal.aborted) throw error
    const message = (error as Error).message
    if (summary) {
      flush(summary.changes)
      progress(summary, true, message)
    }
    if (error instanceof ProviderAuthError) throw new PermanentJobError(message)
    throw error
  }
  flush(summary.changes)
  progress(summary, true)
  return { changed: [...summary.changes.added, ...summary.changes.updated] }
}
