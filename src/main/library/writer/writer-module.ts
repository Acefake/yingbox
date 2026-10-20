/**
 * 写出层模块：组装设置、写出、整理，注册任务类型（writer-write / writer-organize / writer-undo），
 * 实现 writer.* IPC 方法并推送 writer-progress。LibraryService 只做转发。
 *
 * 不形成循环：写出的 nfo / 图片不关联任何条目，扫描器收录它们不会让条目变化，
 * 也就不会触发识别和“识别后自动写出”；内容未变的文件直接跳过、不改 mtime。
 */
import { randomUUID } from 'node:crypto'
import {
  type ItemsChangedEvent,
  type JobAccepted,
  LibraryError,
  type LibraryEvent,
  type OrganizeAccepted,
  type OrganizeBatchInfo,
  type OrganizePlan,
  type WriterProgressEvent,
  type WriterSettings,
} from '../../../shared/library/ipc'
import type { CatalogQuery } from '../catalog/query'
import { type LibraryDb, transaction } from '../db/database'
import type { KeyedMutex } from '../jobs/keyed-mutex'
import {
  type JobContext,
  type JobQueue,
  PermanentJobError,
} from '../jobs/queue'
import type { LibraryStore } from '../libraries/library-store'
import { SettingsStore } from '../providers/settings-store'
import type { MoveOps } from './fs/file-ops'
import { type PlannedMove, planOrganize } from './organize/organize-planner'
import { type OrganizeCounts, OrganizeRunner } from './organize/organize-runner'
import { type PlannedOutput, planOutputs } from './write/output-plan'
import { type ImageSource, OutputWriter } from './write/output-writer'
import { WriterSettingsStore } from './writer-settings'
import { WriterStore } from './writer-store'

/** 模块依赖。 */
export interface WriterModuleOptions {
  db: LibraryDb
  queue: JobQueue
  catalogQuery: CatalogQuery
  libraries: LibraryStore
  /** 与扫描共用的媒体库锁。 */
  locks: KeyedMutex<number>
  emit: (event: LibraryEvent) => void
  /** 原图缓存（复用识别模块的 ImageCache）；没有时不写图片。 */
  images?: ImageSource
  /** 整理时的底层 rename（测试注入以模拟跨盘）。 */
  moveOps?: MoveOps
  /** 设备号（测试注入以模拟跨盘预览）。 */
  deviceOf?: (path: string) => Promise<number | undefined>
  log?: (message: string) => void
}

/** 任务优先级：用户点的写出 / 整理 > 识别后自动写出。 */
const PRIORITY = { user: 12, auto: 2, organize: 18 } as const
/** 预览计划的有效期。 */
const PLAN_TTL_MS = 30 * 60_000
/** 进度事件最小间隔。 */
const PROGRESS_INTERVAL_MS = 250
/** 同时写出的条目数（每个条目内部按顺序写）。 */
const WRITE_CONCURRENCY = 4

interface WritePayload {
  itemIds: number[]
}
interface BatchPayload {
  batchId: number
}

/** 合并排队中的写出：条目取并集。 */
const mergeWritePayload = (a: unknown, b: unknown): WritePayload => ({
  itemIds: [
    ...new Set([
      ...(a as WritePayload).itemIds,
      ...(b as WritePayload).itemIds,
    ]),
  ],
})

/** 写出层模块。 */
export class WriterModule {
  readonly store: WriterStore
  readonly settings: WriterSettingsStore
  private readonly writer: OutputWriter
  private readonly organizer: OrganizeRunner
  private readonly plans = new Map<
    string,
    { moves: PlannedMove[]; createdAt: number }
  >()

  constructor(private readonly options: WriterModuleOptions) {
    this.store = new WriterStore(options.db)
    this.settings = new WriterSettingsStore(new SettingsStore(options.db))
    this.writer = new OutputWriter({
      store: this.store,
      images: options.images,
    })
    this.organizer = new OrganizeRunner({
      db: options.db,
      store: this.store,
      locks: options.locks,
      library: id => options.libraries.get(id),
      moveOps: options.moveOps,
    })
    options.queue.register(
      'writer-write',
      (p, ctx) => this.runWrite(p as WritePayload, ctx),
      {
        merge: mergeWritePayload,
      }
    )
    options.queue.register('writer-organize', (p, ctx) =>
      this.runBatch((p as BatchPayload).batchId, 'organize', ctx)
    )
    options.queue.register('writer-undo', (p, ctx) =>
      this.runBatch((p as BatchPayload).batchId, 'undo', ctx)
    )
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  getSettings(): WriterSettings {
    return this.settings.get()
  }

  setSettings(value: WriterSettings): WriterSettings {
    return this.settings.set(value, Date.now())
  }

  /** 写出这些条目（排队）。 */
  write(itemIds: number[]): JobAccepted {
    return this.enqueueWrite(itemIds, PRIORITY.user)
  }

  /** 识别后自动写出（设置关闭时什么都不做）。 */
  enqueueAuto(itemIds: number[]): void {
    if (!itemIds.length || !this.settings.get().autoWriteAfterIdentify) return
    this.enqueueWrite(itemIds, PRIORITY.auto)
  }

  /** 整理预览。 */
  async previewOrganize(itemIds: number[]): Promise<OrganizePlan> {
    this.prunePlans()
    const top = this.store.topLevelIds(itemIds)
    if (!top.length) throw new LibraryError('not-found', '条目不存在')
    const preview = await planOrganize(top, this.settings.get(), {
      getItem: id => this.options.catalogQuery.getItem(id),
      library: id => this.options.libraries.get(id),
      foreignVideos: (dir, id) => this.store.foreignVideosIn(dir, id),
      deviceOf: this.options.deviceOf,
    })
    const planId = randomUUID()
    this.plans.set(planId, { moves: preview.moves, createdAt: Date.now() })
    return {
      planId,
      unchanged: preview.unchanged,
      entries: preview.moves.map(({ libraryId: _, ...entry }) => entry),
    }
  }

  /** 执行预览过的计划（只执行没有冲突的项）。 */
  applyOrganize(planId: string): OrganizeAccepted {
    if (!this.settings.get().organize.enabled) {
      throw new LibraryError(
        'conflict',
        '整理（改名移动）未开启，请先在设置里开启'
      )
    }
    this.prunePlans()
    const plan = this.plans.get(planId)
    if (!plan)
      throw new LibraryError('not-found', '整理计划不存在或已过期，请重新预览')
    const moves = plan.moves.filter(m => !m.conflict)
    if (!moves.length)
      throw new LibraryError('conflict', '计划里没有可执行的项')
    this.plans.delete(planId)
    const order = { video: 0, sidecar: 1, folder: 2 } as const
    const ops = [...moves]
      .sort((a, b) => order[a.kind] - order[b.kind])
      .map(m => ({
        itemId: m.itemId,
        libraryId: m.libraryId,
        kind: m.kind,
        src: m.from,
        dst: m.to,
        crossDevice: m.crossDevice,
      }))
    const itemIds = [...new Set(moves.map(m => m.itemId))]
    const batchId = transaction(this.options.db, () =>
      this.store.createBatch(itemIds, ops, Date.now())
    )
    const job = this.options.queue.enqueue({
      type: 'writer-organize',
      key: `writer-organize:${batchId}`,
      payload: { batchId } satisfies BatchPayload,
      priority: PRIORITY.organize,
      maxAttempts: 1,
    })
    return { batchId, jobId: job.id }
  }

  /** 撤销一个批次（排队）。 */
  undoOrganize(batchId: number): JobAccepted {
    const batch = this.store.batch(batchId)
    if (!batch)
      throw new LibraryError('not-found', `整理批次 ${batchId} 不存在`)
    if (
      batch.state !== 'done' &&
      batch.state !== 'partial' &&
      batch.state !== 'failed'
    ) {
      throw new LibraryError('conflict', `批次状态为 ${batch.state}，不能撤销`)
    }
    this.store.setBatchState(batchId, 'undoing')
    const job = this.options.queue.enqueue({
      type: 'writer-undo',
      key: `writer-undo:${batchId}`,
      payload: { batchId } satisfies BatchPayload,
      priority: PRIORITY.organize,
      maxAttempts: 1,
    })
    return { jobId: job.id }
  }

  /** 最近的整理批次。 */
  listOrganizeBatches(): OrganizeBatchInfo[] {
    return this.store.batches()
  }

  // —————————————————————————— 任务 ——————————————————————————

  private enqueueWrite(itemIds: number[], priority: number): JobAccepted {
    const job = this.options.queue.enqueue({
      type: 'writer-write',
      key: 'writer-write',
      payload: { itemIds } satisfies WritePayload,
      priority,
    })
    return { jobId: job.id }
  }

  private prunePlans(): void {
    const now = Date.now()
    for (const [id, plan] of this.plans) {
      if (now - plan.createdAt > PLAN_TTL_MS) this.plans.delete(id)
    }
  }

  /** 节流的进度推送。 */
  private progress(
    base: Pick<WriterProgressEvent, 'jobId' | 'mode' | 'batchId'>
  ) {
    let last = 0
    return (
      c: Omit<
        WriterProgressEvent,
        'type' | 'jobId' | 'mode' | 'batchId' | 'finished'
      >,
      finished: boolean
    ): void => {
      const now = Date.now()
      if (!finished && now - last < PROGRESS_INTERVAL_MS) return
      last = now
      this.options.emit({ type: 'writer-progress', ...base, ...c, finished })
    }
  }

  /** 写出任务：先为全部条目做计划（只读数据库），再按条目并发写。 */
  private async runWrite(
    payload: WritePayload,
    ctx: JobContext
  ): Promise<void> {
    const settings = this.settings.get()
    const plans: Array<{ itemId: number; outputs: PlannedOutput[] }> = []
    for (const id of this.store.topLevelIds(payload.itemIds)) {
      const node = this.options.catalogQuery.getItem(id)
      if (!node) continue
      const library = this.options.libraries.get(node.libraryId)
      plans.push({
        itemId: id,
        outputs: planOutputs(node, {
          libraryRoot: library.root,
          settings,
          sharedDir: dir => this.store.foreignVideosIn(dir, id).length > 0,
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
    const report = this.progress({ jobId: ctx.job.id, mode: 'write' })
    let lastError: string | undefined
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < plans.length) {
        const plan = plans[next++]
        for (const output of plan.outputs) {
          ctx.signal.throwIfAborted()
          const result = await this.writer.write(
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
        this.store.markWritten(plan.itemId, Date.now())
      }
    }
    await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker))
    if (lastError)
      this.options.log?.(`写出失败 ${counts.failed} 个，最后一个：${lastError}`)
    report({ ...counts, ...(lastError ? { error: lastError } : {}) }, true)
  }

  /** 整理 / 撤销任务。 */
  private async runBatch(
    batchId: number,
    mode: 'organize' | 'undo',
    ctx: JobContext
  ): Promise<void> {
    const batch = this.store.batch(batchId)
    if (!batch) throw new PermanentJobError(`整理批次 ${batchId} 不存在`)
    const report = this.progress({ jobId: ctx.job.id, mode, batchId })
    const onProgress = (c: OrganizeCounts): void => {
      ctx.progress(c.total ? c.done / c.total : 1)
      report(
        {
          total: c.total,
          done: c.done,
          written: c.moved,
          skipped: c.skipped,
          failed: c.failed,
        },
        false
      )
    }
    let counts: OrganizeCounts
    try {
      counts =
        mode === 'organize'
          ? await this.organizer.apply(batchId, ctx.signal, onProgress)
          : await this.organizer.undo(batchId, ctx.signal, onProgress)
    } catch (error) {
      const message = (error as Error).message
      this.store.setBatchState(batchId, 'partial', {
        finishedAt: Date.now(),
        error: message,
      })
      throw error
    }
    const now = Date.now()
    const error = counts.lastError ?? null
    if (mode === 'organize') {
      const state = !counts.failed
        ? 'done'
        : counts.moved
          ? 'partial'
          : 'failed'
      this.store.setBatchState(batchId, state, { finishedAt: now, error })
    } else {
      this.store.setBatchState(batchId, counts.failed ? 'partial' : 'undone', {
        undoneAt: now,
        error,
      })
    }
    this.emitItems(batch.itemIds)
    report(
      {
        total: counts.total,
        done: counts.done,
        written: counts.moved,
        skipped: counts.skipped,
        failed: counts.failed,
        ...(error ? { error } : {}),
      },
      true
    )
  }

  /** 路径变化后通知订阅方刷新这些条目。 */
  private emitItems(itemIds: number[]): void {
    const byLibrary = new Map<number, number[]>()
    for (const id of itemIds) {
      const lib = this.store.libraryOf(id)
      if (lib !== undefined)
        byLibrary.set(lib, [...(byLibrary.get(lib) ?? []), id])
    }
    for (const [libraryId, updated] of byLibrary) {
      const event: ItemsChangedEvent = {
        type: 'items-changed',
        libraryId,
        added: [],
        updated,
        removed: [],
        reset: false,
      }
      this.options.emit(event)
    }
  }
}
