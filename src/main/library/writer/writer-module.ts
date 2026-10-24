/**
 * 写出层模块：组装设置、写出、整理，注册任务类型（writer-write / writer-organize / writer-undo /
 * writer-auto-organize），实现 writer.* IPC 方法并推送 writer-progress。LibraryService 只做转发。
 * 识别后的自动写出 / 自动整理按条目所在媒体库的自动化设置分组，作为识别任务的后继给出（见 auto-rules）；
 * 自动整理结束后的写出写在 writer-auto-organize 的任务定义里。
 *
 * 不形成循环：写出的 nfo / 图片不关联任何条目，扫描器收录它们不会让条目变化，
 * 也就不会触发识别和“识别后自动写出”；内容未变的文件直接跳过、不改 mtime。
 *
 * 远程源（WebDAV / Alist）库只读：手动写出跳过它的条目、整理直接拒绝、不给自动写出 / 整理后继。
 *
 * 任务执行在 writer-jobs，纯规则在 writer-rules。
 */
import { randomUUID } from 'node:crypto'
import {
  type JobAccepted,
  LibraryError,
  type LibraryEvent,
  type OrganizeAccepted,
  type OrganizeBatchInfo,
  type OrganizePlan,
  type WriterSettings,
} from '../../../shared/library/ipc'
import { isRemotePath } from '../../../shared/webdav/remote-path'
import type { CatalogQuery } from '../catalog/query'
import { type LibraryDb, transaction } from '../db/database'
import type { KeyedMutex } from '../jobs/keyed-mutex'
import type { FollowupSpec } from '../jobs/followups'
import type { JobQueue } from '../jobs/queue'
import type { LibraryStore } from '../libraries/library-store'
import { SettingsStore } from '../providers/settings-store'
import {
  afterAutoOrganize,
  autoFollowups,
  mergeAutoOrganizePayload,
} from './auto-rules'
import type { AutoOrganizePayload } from './auto-rules'
import type { MoveOps } from './fs/file-ops'
import { runAutoOrganize } from './organize/auto-organize'
import { type PlannedMove, planOrganize } from './organize/organize-planner'
import { OrganizeRunner } from './organize/organize-runner'
import { type ImageSource, OutputWriter } from './write/output-writer'
import { type WriterJobDeps, runBatch, runWrite } from './writer-jobs'
import {
  type BatchPayload,
  PRIORITY,
  type WritePayload,
  canUndo,
  expiredPlans,
  mergeWritePayload,
  organizeOps,
  writeJobSpec,
} from './writer-rules'
import { WriterSettingsStore } from './writer-settings'
import { WriterStore } from './writer-store'

/** 远程源库只读的提示。 */
const REMOTE_READ_ONLY =
  'WebDAV 媒体库只读：只刮削到影盒的库里，不写 NFO / 图片、不整理文件'

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
  /** 番号库条目演员的资料（演员库），NFO 的 <actor> 据此补头像与生日等扩展字段。 */
  actorProfiles?: WriterJobDeps['actorProfiles']
  /** 整理时的底层 rename（测试注入以模拟跨盘）。 */
  moveOps?: MoveOps
  /** 设备号（测试注入以模拟跨盘预览）。 */
  deviceOf?: (path: string) => Promise<number | undefined>
  log?: (message: string) => void
}

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
    const jobs: WriterJobDeps = {
      store: this.store,
      writer: this.writer,
      organizer: this.organizer,
      catalogQuery: options.catalogQuery,
      libraries: options.libraries,
      settings: () => this.settings.get(),
      actorProfiles: options.actorProfiles,
      emit: options.emit,
      log: options.log,
    }
    options.queue.register(
      'writer-write',
      (p, ctx) => runWrite(jobs, p as WritePayload, ctx),
      { merge: mergeWritePayload }
    )
    options.queue.register('writer-organize', (p, ctx) =>
      runBatch(jobs, (p as BatchPayload).batchId, 'organize', ctx)
    )
    options.queue.register('writer-undo', (p, ctx) =>
      runBatch(jobs, (p as BatchPayload).batchId, 'undo', ctx)
    )
    const autoJobs = { ...jobs, db: options.db, deviceOf: options.deviceOf }
    options.queue.register(
      'writer-auto-organize',
      (p, ctx) => runAutoOrganize(autoJobs, p as AutoOrganizePayload, ctx),
      {
        merge: mergeAutoOrganizePayload,
        // 整理失败也写出：NFO 与图片写到条目现在的位置
        followups: {
          when: 'settled',
          next: ({ payload }) =>
            afterAutoOrganize(payload as AutoOrganizePayload),
        },
      }
    )
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  getSettings(): WriterSettings {
    return this.settings.get()
  }

  setSettings(value: WriterSettings): WriterSettings {
    return this.settings.set(value, Date.now())
  }

  /** 写出这些条目（排队）；远程源（WebDAV）库的条目只读，跳过。 */
  write(itemIds: number[]): JobAccepted {
    const writable = itemIds.filter(id => !this.inRemoteLibrary(id))
    if (!writable.length) throw new LibraryError('conflict', REMOTE_READ_ONLY)
    const job = this.options.queue.enqueue(
      writeJobSpec(writable, PRIORITY.user)
    )
    return { jobId: job.id }
  }

  /** 识别后的后继：按库设置自动写出 / 先整理再写出（都关闭时为空）。 */
  autoFollowups(itemIds: number[]): FollowupSpec[] {
    return autoFollowups(itemIds, this.settings.get(), {
      libraryOf: id => this.store.libraryOf(id),
      // 远程源库只读：不自动写出、不自动整理
      automationOf: id => {
        const lib = this.options.libraries.find(id)
        return lib && !isRemotePath(lib.root) ? lib.automation : undefined
      },
    })
  }

  /** 整理预览。 */
  async previewOrganize(itemIds: number[]): Promise<OrganizePlan> {
    this.prunePlans()
    const top = this.store.topLevelIds(itemIds)
    if (!top.length) throw new LibraryError('not-found', '条目不存在')
    if (top.some(id => this.inRemoteLibrary(id)))
      throw new LibraryError('conflict', REMOTE_READ_ONLY)
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
    const { ops, itemIds } = organizeOps(plan.moves)
    if (!ops.length) throw new LibraryError('conflict', '计划里没有可执行的项')
    this.plans.delete(planId)
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
    if (!canUndo(batch.state)) {
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

  /** 条目是否在远程源（WebDAV）库里。 */
  private inRemoteLibrary(itemId: number): boolean {
    const libraryId = this.store.libraryOf(itemId)
    if (libraryId === undefined) return false
    const lib = this.options.libraries.find(libraryId)
    return lib !== undefined && isRemotePath(lib.root)
  }

  private prunePlans(): void {
    for (const id of expiredPlans(this.plans, Date.now())) this.plans.delete(id)
  }
}
