/**
 * 写出层任务的执行：writer-write（写 NFO / 图片）与 writer-organize / writer-undo（整理 / 撤销批次）。
 * 由 WriterModule 注册进任务队列。
 */
import type {
  LibraryEvent,
  WriterProgressEvent,
  WriterSettings,
} from '../../../shared/library/ipc'
import type { TmdbImageSizes } from '../../../shared/library/scrape-prefs'
import type { CatalogQuery } from '../catalog/query'
import { type JobContext, PermanentJobError } from '../jobs/queue'
import type { NfoActorLookup } from '../actors/actor-store'
import type { LibraryStore } from '../libraries/library-store'
import type { OrganizeCounts, OrganizeRunner } from './organize/organize-runner'
import { type PlannedOutput, planOutputs } from './write/output-plan'
import type { OutputWriter } from './write/output-writer'
import {
  WRITE_CONCURRENCY,
  type WritePayload,
  itemsUpdatedEvents,
  organizeFinalState,
  organizeProgress,
  throttled,
  undoFinalState,
} from './writer-rules'
import type { WriterStore } from './writer-store'

/** 任务执行需要的模块能力。 */
export interface WriterJobDeps {
  store: WriterStore
  writer: OutputWriter
  organizer: OrganizeRunner
  catalogQuery: CatalogQuery
  libraries: LibraryStore
  settings: () => WriterSettings
  /** 条目演员的资料（名字 → 资料）；缺省不补。 */
  actorProfiles?: (itemId: number) => NfoActorLookup
  /** 写出图片的 TMDB 尺寸（刮削偏好）；缺省高清。 */
  imageSizes?: () => TmdbImageSizes
  emit: (event: LibraryEvent) => void
  log?: (message: string) => void
}

/** writer-progress 里除了固定字段之外的计数。 */
type ProgressCounts = Omit<
  WriterProgressEvent,
  'type' | 'jobId' | 'mode' | 'batchId' | 'finished'
>

/** 节流的进度推送。 */
function progressReporter(
  deps: WriterJobDeps,
  base: Pick<WriterProgressEvent, 'jobId' | 'mode' | 'batchId'>
): (c: ProgressCounts, finished: boolean) => void {
  return throttled<ProgressCounts>((c, finished) =>
    deps.emit({ type: 'writer-progress', ...base, ...c, finished })
  )
}

/** 写出任务：先为全部条目做计划（只读数据库），再按条目并发写。 */
export async function runWrite(
  deps: WriterJobDeps,
  payload: WritePayload,
  ctx: JobContext
): Promise<void> {
  const settings = deps.settings()
  const plans: Array<{ itemId: number; outputs: PlannedOutput[] }> = []
  for (const id of deps.store.topLevelIds(payload.itemIds)) {
    const node = deps.catalogQuery.getItem(id)
    if (!node) continue
    const library = deps.libraries.get(node.libraryId)
    plans.push({
      itemId: id,
      outputs: planOutputs(node, {
        libraryRoot: library.root,
        settings,
        sharedDir: dir => deps.store.foreignVideosIn(dir, id).length > 0,
        actors: deps.actorProfiles?.(id),
        imageSizes: deps.imageSizes?.(),
      }),
    })
  }
  const counts = {
    total: plans.reduce((n, p) => n + p.outputs.length, 0),
    done: 0,
    written: 0,
    skipped: 0,
    failed: 0,
  }
  const report = progressReporter(deps, { jobId: ctx.job.id, mode: 'write' })
  let lastError: string | undefined
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < plans.length) {
      const plan = plans[next++]
      for (const output of plan.outputs) {
        ctx.signal.throwIfAborted()
        const result = await deps.writer.write(
          output,
          settings.nfo.mode,
          ctx.signal
        )
        if (result.status === 'written') counts.written++
        else if (result.status === 'skipped') counts.skipped++
        else {
          counts.failed++
          lastError = `${output.path}：${result.error}`
        }
        counts.done++
        ctx.progress(counts.total ? counts.done / counts.total : 1)
        report(counts, false)
      }
      deps.store.markWritten(plan.itemId, Date.now())
    }
  }
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker))
  if (lastError)
    deps.log?.(`写出失败 ${counts.failed} 个，最后一个：${lastError}`)
  report({ ...counts, ...(lastError ? { error: lastError } : {}) }, true)
}

/** 整理 / 撤销任务。 */
export async function runBatch(
  deps: WriterJobDeps,
  batchId: number,
  mode: 'organize' | 'undo',
  ctx: JobContext
): Promise<void> {
  const { store } = deps
  const batch = store.batch(batchId)
  if (!batch) throw new PermanentJobError(`整理批次 ${batchId} 不存在`)
  const report = progressReporter(deps, { jobId: ctx.job.id, mode, batchId })
  const onProgress = (c: OrganizeCounts): void => {
    ctx.progress(c.total ? c.done / c.total : 1)
    report(organizeProgress(c), false)
  }
  let counts: OrganizeCounts
  try {
    counts =
      mode === 'organize'
        ? await deps.organizer.apply(batchId, ctx.signal, onProgress)
        : await deps.organizer.undo(batchId, ctx.signal, onProgress)
  } catch (error) {
    const message = (error as Error).message
    store.setBatchState(batchId, 'partial', {
      finishedAt: Date.now(),
      error: message,
    })
    // 整批出错也发结束事件，界面才能提示（否则只在日志里）
    report(
      { total: 0, done: 0, written: 0, skipped: 0, failed: 0, error: message },
      true
    )
    throw error
  }
  const now = Date.now()
  const error = counts.lastError ?? null
  if (mode === 'organize') {
    store.setBatchState(batchId, organizeFinalState(counts), {
      finishedAt: now,
      error,
    })
  } else {
    store.setBatchState(batchId, undoFinalState(counts), {
      undoneAt: now,
      error,
    })
  }
  // 路径变化后通知订阅方刷新这些条目
  for (const event of itemsUpdatedEvents(batch.itemIds, id =>
    store.libraryOf(id)
  )) {
    deps.emit(event)
  }
  report({ ...organizeProgress(counts), ...(error ? { error } : {}) }, true)
}
