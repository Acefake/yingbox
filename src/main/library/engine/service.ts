/**
 * 媒体库服务：把数据库、任务队列、扫描器、监控组装起来，实现 IPC 契约的每个方法，并把变化广播给订阅方。
 * 新文件的链路：监控（事件 / 定时扫描 / 外部变更通知）→ 增量扫描（写入稳定判定）→ 按库设置自动识别 → 识别后按库设置自动整理 / 写出（见 docs/library-server.md「自动入库」），写成各任务定义里的后继（followups，规则见 jobs/followups.ts），由任务队列统一派发；入库之后的宣布与自动字幕在 intake（arrivals/intake.ts），只看事件、不进任务链。
 * 不依赖 Electron：引擎进程入口（entry.ts）只负责消息收发，测试可以直接构造本类。扫描 / 解析 / 指纹 / 动态范围探测任务在 library-jobs，纯规则在 service-rules，变化入口在 library-watch。
 * 网盘模式的库不读视频内容：后台指纹 / 动态范围探测跳过，识别时的时长探测 / 哈希限速（见 cloud-reads）。
 */
import type {
  ApplyMatchRequest,
  ApplyMatchResult,
  FacetListRequest,
  FacetValue,
  IdentifyRequest,
  JobAccepted,
  LibraryEvent,
  LibraryInfo,
  LibraryItemNode,
  LibraryItemSummary,
  LibraryQueryResult,
  LibraryRpcMap,
  MatchCandidatesResult,
  NormalizedLibraryQuery,
  NotifyChangesRequest,
  NotifyChangesResult,
  ProviderStatus,
  RefreshMetadataRequest,
  ScanAccepted,
  SetProviderTokenRequest,
  UpdateLibraryRequest,
} from '../../../shared/library/ipc'
import { ActorModule } from '../actors/actor-module'
import { type Intake, createIntake } from '../arrivals/intake'
import { type VisualModule, createVisualModule } from '../visual/visual-setup'
import { KeyedMutex } from '../jobs/keyed-mutex'
import { WriterModule } from '../writer/writer-module'
import { CatalogStore, type ItemChanges } from '../catalog/catalog-store'
import { CatalogQuery } from '../catalog/query'
import { type LibraryDb, openLibraryDb, transaction } from '../db/database'
import { IdentifyModule } from '../identify/identify-module'
import { probeFileDuration } from '../identify/media-duration'
import { JobStore } from '../jobs/job-store'
import { JobQueue, PermanentJobError } from '../jobs/queue'
import {
  type LibraryRecord,
  LibraryStore,
  toLibraryInfo,
} from '../libraries/library-store'
import { fingerprintFile } from '../scanner/fingerprint'
import { PARSER_VERSION } from '../scanner/parse'
import { ScanStore } from '../scanner/scan-store'
import { Pacer, forCloud } from './cloud-reads'
import { LibraryWatch } from './library-watch'
import type { LibraryServiceOptions } from './service-options'
import { type LibraryJobDeps, registerLibraryJobs } from './library-jobs'
import {
  PRIORITY,
  type ScanPayload,
  backfillJobs,
  itemsChangedEvent,
  libraryJobSpec,
  scanJobKey,
} from './service-rules'

export { mergeScanPayload } from './service-rules'
export type { LibraryServiceOptions } from './service-options'

/** 媒体库服务。 */
export class LibraryService {
  readonly db: LibraryDb
  private readonly libraries: LibraryStore
  private readonly scanStore: ScanStore
  private readonly catalog: CatalogStore
  private readonly catalogQuery: CatalogQuery
  readonly queue: JobQueue

  /** 取消任务；排队的整理批次同步结束，已完成的移动仍可撤销。 */
  cancelJob(jobId: number): boolean {
    const job = this.queue.get(jobId)
    if (!job || !this.queue.cancel(jobId)) return false
    if (
      job.state === 'queued' &&
      (job.type === 'writer-organize' || job.type === 'writer-undo')
    ) {
      const payload = job.payload as { batchId?: number }
      if (typeof payload.batchId === 'number')
        this.writer.cancelQueuedBatch(payload.batchId)
    }
    return true
  }
  /** 识别与刮削。 */
  readonly identifier: IdentifyModule
  /** 写出层（NFO / 图片 / 整理）。 */
  readonly writer: WriterModule
  /** 演员库（番号库的演员资料）。 */
  readonly actors: ActorModule
  /** 按画面搜（番号库封面与剧照的 CLIP 索引）。 */
  readonly visual: VisualModule
  readonly intake: Intake
  /** 同一媒体库的扫描与整理互斥。 */
  private readonly locks = new KeyedMutex<number>()
  private readonly watch: LibraryWatch
  private readonly listeners = new Set<(event: LibraryEvent) => void>()
  private readonly fingerprint: (path: string) => Promise<string | undefined>
  private readonly log: (message: string) => void

  constructor(private readonly options: LibraryServiceOptions) {
    this.db = openLibraryDb(options.dbPath)
    this.libraries = new LibraryStore(this.db)
    this.scanStore = new ScanStore(this.db)
    this.catalog = new CatalogStore(this.db)
    this.catalogQuery = new CatalogQuery(this.db)
    this.fingerprint = options.fingerprint ?? fingerprintFile
    this.log = options.log ?? (() => {})
    this.watch = new LibraryWatch(
      options,
      this.log,
      () => this.libraries.list(),
      (libraryId, dirs) => this.onWatchChange(libraryId, dirs)
    )
    const isCloudPath = (path: string): Promise<boolean> =>
      this.watch.isCloudPath(path)
    // 网盘上：后台批量读视频跳过，识别时按需读限速
    const backgroundRead = forCloud(p => this.fingerprint(p), isCloudPath)
    const pacer = new Pacer(options.cloudReadIntervalMs)
    this.queue = new JobQueue(new JobStore(this.db), {
      concurrency: options.concurrency,
      onEvent: event => this.emit(event),
      log: this.log,
    })
    const jobs: LibraryJobDeps = {
      db: this.db,
      scanStore: this.scanStore,
      catalog: this.catalog,
      fingerprint: backgroundRead,
      probeVideo: options.probeVideo,
      remote: options.remote,
      libraryFor: id => this.libraryFor(id),
      onLibraryScanned: id => {
        this.libraries.markScanned(id, Date.now())
        this.emitLibraries()
      },
      emitItems: (id, changes) => this.emitItems(id, changes),
      identifyFollowup: id =>
        this.libraries.find(id)?.automation.identify
          ? this.identifier.autoFollowup(id)
          : null,
      // 网盘不读视频内容：不排指纹任务
      isCloudLibrary: id => this.isCloudLibrary(id),
      settleFor: lib => this.watch.settleFor(lib),
      onUnsettled: (id, u) => this.watch.recheck(id, u.dirs, u.retryInMs),
      log: this.log,
    }
    registerLibraryJobs(this.queue, this.locks, jobs)
    this.actors = new ActorModule({
      db: this.db,
      queue: this.queue,
      emit: event => this.emit(event),
      mediaDir: options.identify?.mediaDir,
      identify: () => this.identifier,
      log: this.log,
    })
    this.identifier = new IdentifyModule({
      ...options.identify,
      probeDuration: forCloud(
        options.identify?.probeDuration ?? probeFileDuration,
        isCloudPath,
        pacer
      ),
      avatars: this.actors.avatars,
      db: this.db,
      queue: this.queue,
      catalogQuery: this.catalogQuery,
      emit: event => this.emit(event),
      fingerprint: forCloud(p => this.fingerprint(p), isCloudPath, pacer),
      followups: itemIds => [
        ...this.actors.identifiedFollowups(itemIds),
        ...this.writer.autoFollowups(itemIds),
        ...this.visual.identifiedFollowups(itemIds),
      ],
      log: this.log,
    })
    this.visual = createVisualModule(options, this)
    this.writer = new WriterModule({
      db: this.db,
      queue: this.queue,
      catalogQuery: this.catalogQuery,
      libraries: this.libraries,
      locks: this.locks,
      emit: event => this.emit(event),
      images: this.identifier.images,
      actorProfiles: itemId => this.actors.nfoProfiles(itemId),
      moveOps: options.writer?.moveOps,
      deviceOf: options.writer?.deviceOf,
      log: this.log,
    })
    this.intake = createIntake(options, this)
  }

  /** 启动：恢复中断的任务，旧解析版本的文件排重解析，开始监控（并补扫停机期间的变化）。 */
  async start(): Promise<void> {
    for (const lib of this.libraries.list()) {
      if (this.scanStore.staleParsed(lib.id, PARSER_VERSION, 0, 1).length) {
        this.queue.enqueue(libraryJobSpec('parse', lib.id))
      }
    }
    this.identifier.start()
    this.actors.start()
    this.queue.start()
    const libs = this.libraries.list()
    for (const lib of libs) this.watch.start(lib, true)
    this.emitLibrariesWhenJudged(libs)
    this.intake.start()
  }

  /** 停止任务和监控，关闭数据库。 */
  async close(): Promise<void> {
    this.intake.close()
    this.watch.close()
    await this.queue.stop()
    this.db.close()
  }

  /** 订阅事件，返回取消订阅函数。 */
  subscribe(listener: (event: LibraryEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // —————————————————————————— 契约方法 ——————————————————————————

  /** 全部媒体库。 */
  listLibraries(): LibraryInfo[] {
    return this.libraries
      .list()
      .map(lib => toLibraryInfo(lib, this.watch.storage.known(lib)))
  }

  /** 添加媒体库并立即排一次整库扫描。 */
  async addLibrary(
    request: LibraryRpcMap['addLibrary']['params']
  ): Promise<LibraryInfo> {
    const lib = this.libraries.add(request, Date.now())
    this.enqueueScan({ libraryId: lib.id }, PRIORITY.scan)
    this.emitLibraries()
    this.watch.start(lib, false)
    this.emitLibrariesWhenJudged([lib])
    return toLibraryInfo(lib, this.watch.storage.known(lib))
  }

  /** 改名 / 改自动化设置；监控开关与存储立即生效（本地盘补一次增量扫描）。 */
  async updateLibrary(request: UpdateLibraryRequest): Promise<LibraryInfo> {
    const before = this.libraries.get(request.libraryId)
    const lib = this.libraries.update(request)
    const { watch, storage } = lib.automation
    if (
      before.automation.watch !== watch ||
      before.automation.storage !== storage
    )
      this.watch.restart(lib)
    this.emitLibraries()
    if (before.automation.storage !== storage)
      this.emitLibrariesWhenJudged([lib], true)
    return toLibraryInfo(lib, this.watch.storage.known(lib))
  }

  /** 删除媒体库及其全部数据。 */
  async removeLibrary({ libraryId }: { libraryId: number }): Promise<void> {
    this.watch.remove(libraryId)
    transaction(this.db, () => this.libraries.remove(libraryId))
    this.emitLibraries()
  }

  /** 手动扫描。 */
  scan(request: LibraryRpcMap['scan']['params']): ScanAccepted {
    this.libraries.get(request.libraryId)
    const job = this.enqueueScan(
      { libraryId: request.libraryId, full: request.full },
      PRIORITY.scan
    )
    return { jobId: job.id }
  }

  /** 分页查询顶层条目。 */
  query(query: NormalizedLibraryQuery): LibraryQueryResult {
    return this.catalogQuery.list(query)
  }

  /** 分面取值与条目数（海报墙筛选面板）。 */
  facetValues(request: FacetListRequest): FacetValue[] {
    return this.catalogQuery.facetValues(request)
  }

  /** 条目详情。 */
  getItem({ itemId }: { itemId: number }): LibraryItemNode | null {
    return this.catalogQuery.getItem(itemId)
  }

  /** 识别条目。 */
  identify(request: IdentifyRequest): JobAccepted {
    if (request.libraryId !== undefined) this.libraries.get(request.libraryId)
    return this.identifier.identify(request)
  }

  /** 条目的匹配候选。 */
  getMatchCandidates({ itemId }: { itemId: number }): MatchCandidatesResult {
    return this.identifier.getMatchCandidates(itemId)
  }

  /** 手动匹配。 */
  applyMatch(request: ApplyMatchRequest): Promise<ApplyMatchResult> {
    return this.identifier.applyMatch(request)
  }

  /** 锁定匹配。 */
  lockMatch({ itemId }: { itemId: number }): LibraryItemSummary {
    return this.identifier.lockMatch(itemId)
  }

  /** 解除锁定。 */
  unlockMatch({ itemId }: { itemId: number }): LibraryItemSummary {
    return this.identifier.unlockMatch(itemId)
  }

  /** 刷新元数据。 */
  refreshMetadata(request: RefreshMetadataRequest): JobAccepted {
    if (request.libraryId !== undefined) this.libraries.get(request.libraryId)
    return this.identifier.refreshMetadata(request)
  }

  /** 设置元数据源令牌。 */
  setProviderToken(request: SetProviderTokenRequest): ProviderStatus {
    return this.identifier.setProviderToken(request)
  }

  /** 元数据源配置状态。 */
  getProviderStatus(): ProviderStatus {
    return this.identifier.getProviderStatus()
  }

  /** 外部文件变更通知：对应到库目录、去抖合并后按目录增量扫描。 */
  notifyChanges(request: NotifyChangesRequest): NotifyChangesResult {
    return this.watch.notify(request)
  }

  // —————————————————————————— 宿主用（不在 IPC 契约里） ——————————————————————————

  /** 片库里登记过的视频文件路径；不存在或不是视频返回 null（独立服务据此决定能不能给出视频流）。 */
  videoFilePath(fileId: number): string | null {
    return this.catalogQuery.videoFilePath(fileId)
  }

  /** 库是否按网盘处理（悬停预览据此不给视频）；库不存在按网盘处理。 */
  isCloudLibrary(libraryId: number): Promise<boolean> {
    const lib = this.libraries.find(libraryId)
    return lib ? this.watch.isCloud(lib) : Promise.resolve(true)
  }

  // ———————————— 内部（emit 也给 rpc 层的合并模块用，见 catalog/merge） ————————————

  emit(event: LibraryEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private emitLibraries(): void {
    this.emit({ type: 'libraries-changed', libraries: this.listLibraries() })
  }

  /** 存储判定完后再广播一次列表；判为本地盘的库补排读文件任务（见 backfillJobs）。 */
  private emitLibrariesWhenJudged(
    libs: LibraryRecord[],
    fingerprint = false
  ): void {
    void Promise.all(libs.map(lib => this.watch.isCloud(lib))).then(clouds => {
      this.emitLibraries()
      for (const [i, lib] of libs.entries())
        for (const type of backfillJobs(clouds[i], fingerprint, this.options))
          this.queue.enqueue(libraryJobSpec(type, lib.id))
    })
  }

  private emitItems(libraryId: number, changes: ItemChanges): void {
    const event = itemsChangedEvent(libraryId, changes)
    if (event) this.emit(event)
  }

  private enqueueScan(payload: ScanPayload, priority: number): { id: number } {
    return this.queue.enqueue({
      type: 'scan',
      key: scanJobKey(payload.libraryId),
      payload,
      priority,
    })
  }

  /** 监控发现变化：重读涉及的目录；dirs 为 null（事件丢失 / 定时扫描）时整库增量扫描。 */
  private onWatchChange(libraryId: number, dirs: string[] | null): void {
    try {
      this.enqueueScan(
        dirs ? { libraryId, dirs } : { libraryId },
        PRIORITY.watch
      )
    } catch (error) {
      this.log(`监听触发扫描失败：${(error as Error).message}`)
    }
  }

  /** 取媒体库；已被删除时任务直接失败、不重试。 */
  private libraryFor(libraryId: number): LibraryRecord {
    try {
      return this.libraries.get(libraryId)
    } catch (error) {
      throw new PermanentJobError((error as Error).message)
    }
  }
}
