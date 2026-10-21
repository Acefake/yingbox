/**
 * 媒体库服务：把数据库、任务队列、扫描器、监听器组装起来，实现 IPC 契约的每个方法，
 * 并把变化广播给订阅方。
 *
 * 不依赖 Electron：引擎进程入口（entry.ts）只负责消息收发，测试可以直接构造本类。
 * 扫描 / 解析 / 指纹任务的实现在 library-jobs，纯规则在 service-rules。
 */
import type {
  ApplyMatchRequest,
  ApplyMatchResult,
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
  ProviderStatus,
  RefreshMetadataRequest,
  ScanAccepted,
  SetProviderTokenRequest,
} from '../../../shared/library/ipc'
import { KeyedMutex } from '../jobs/keyed-mutex'
import type { MoveOps } from '../writer/fs/file-ops'
import { WriterModule } from '../writer/writer-module'
import { CatalogStore, type ItemChanges } from '../catalog/catalog-store'
import { CatalogQuery } from '../catalog/query'
import { type LibraryDb, openLibraryDb, transaction } from '../db/database'
import {
  IdentifyModule,
  type IdentifyModuleOptions,
} from '../identify/identify-module'
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
import { LibraryWatcher } from '../scanner/watcher'
import {
  type LibraryJobDeps,
  runFingerprint,
  runParse,
  runScan,
} from './library-jobs'
import {
  type LibraryPayload,
  PRIORITY,
  type ScanPayload,
  itemsChangedEvent,
  mergeScanPayload,
  scanJobKey,
} from './service-rules'

export { mergeScanPayload } from './service-rules'

/** 服务参数。 */
export interface LibraryServiceOptions {
  /** 数据库文件路径；测试可用 ':memory:'。 */
  dbPath: string
  /** 是否启用文件监听，默认 true。 */
  watch?: boolean
  /** 监听去抖静默时间，默认 1000 ms。 */
  watchQuietMs?: number
  /** 同时运行的任务数，默认 2。 */
  concurrency?: number
  /** 指纹实现（文件路径 → hash），测试注入。 */
  fingerprint?: (path: string) => Promise<string | undefined>
  /** 写日志（告警、监听失败）。 */
  log?: (message: string) => void
  /** 识别与刮削的注入项（网络、图片缓存目录、令牌兜底、限速），见 IdentifyModuleOptions。 */
  identify?: Pick<
    IdentifyModuleOptions,
    | 'fetch'
    | 'mediaDir'
    | 'onImagesCached'
    | 'probeDuration'
    | 'env'
    | 'http'
    | 'concurrency'
  >
  /** 写出层的注入项（测试模拟跨盘）。 */
  writer?: {
    moveOps?: MoveOps
    deviceOf?: (path: string) => Promise<number | undefined>
  }
}

/** 媒体库服务。 */
export class LibraryService {
  readonly db: LibraryDb
  private readonly libraries: LibraryStore
  private readonly scanStore: ScanStore
  private readonly catalog: CatalogStore
  private readonly catalogQuery: CatalogQuery
  readonly queue: JobQueue
  /** 识别与刮削。 */
  readonly identifier: IdentifyModule
  /** 写出层（NFO / 图片 / 整理）。 */
  readonly writer: WriterModule
  /** 同一媒体库的扫描与整理互斥。 */
  private readonly locks = new KeyedMutex<number>()
  private readonly watcher: LibraryWatcher | undefined
  private readonly listeners = new Set<(event: LibraryEvent) => void>()
  private readonly fingerprint: (path: string) => Promise<string | undefined>
  private readonly log: (message: string) => void

  constructor(options: LibraryServiceOptions) {
    this.db = openLibraryDb(options.dbPath)
    this.libraries = new LibraryStore(this.db)
    this.scanStore = new ScanStore(this.db)
    this.catalog = new CatalogStore(this.db)
    this.catalogQuery = new CatalogQuery(this.db)
    this.fingerprint = options.fingerprint ?? fingerprintFile
    this.log = options.log ?? (() => {})
    this.queue = new JobQueue(new JobStore(this.db), {
      concurrency: options.concurrency,
      onEvent: event => this.emit(event),
    })
    const jobs: LibraryJobDeps = {
      db: this.db,
      scanStore: this.scanStore,
      catalog: this.catalog,
      fingerprint: path => this.fingerprint(path),
      libraryFor: id => this.libraryFor(id),
      onLibraryScanned: id => {
        this.libraries.markScanned(id, Date.now())
        this.emitLibraries()
      },
      emitItems: (id, changes) => this.emitItems(id, changes),
      enqueueFingerprint: id => this.enqueueLibraryJob('fingerprint', id),
      enqueueIdentify: id => this.identifier.enqueueAuto(id),
      log: this.log,
    }
    this.queue.register(
      'scan',
      (p, ctx) =>
        this.locks.run((p as ScanPayload).libraryId, () =>
          runScan(jobs, p as ScanPayload, ctx)
        ),
      { merge: mergeScanPayload }
    )
    this.queue.register('parse', (p, ctx) =>
      this.locks.run((p as LibraryPayload).libraryId, () =>
        runParse(jobs, p as LibraryPayload, ctx)
      )
    )
    this.queue.register('fingerprint', (p, ctx) =>
      runFingerprint(jobs, p as LibraryPayload, ctx)
    )
    this.identifier = new IdentifyModule({
      ...options.identify,
      db: this.db,
      queue: this.queue,
      catalogQuery: this.catalogQuery,
      emit: event => this.emit(event),
      fingerprint: path => this.fingerprint(path),
      onIdentified: itemIds => this.writer.enqueueAuto(itemIds),
      log: this.log,
    })
    this.writer = new WriterModule({
      db: this.db,
      queue: this.queue,
      catalogQuery: this.catalogQuery,
      libraries: this.libraries,
      locks: this.locks,
      emit: event => this.emit(event),
      images: this.identifier.images,
      moveOps: options.writer?.moveOps,
      deviceOf: options.writer?.deviceOf,
      log: this.log,
    })
    if (options.watch !== false) {
      this.watcher = new LibraryWatcher(
        (libraryId, dirs) => this.onWatchChange(libraryId, dirs),
        (libraryId, error) =>
          this.log(`监听媒体库 ${libraryId} 出错：${error.message}`),
        options.watchQuietMs
      )
    }
  }

  /** 启动：恢复中断的任务，旧解析版本的文件排重解析，开始监听。 */
  async start(): Promise<void> {
    for (const lib of this.libraries.list()) {
      if (this.scanStore.staleParsed(lib.id, PARSER_VERSION, 0, 1).length) {
        this.enqueueLibraryJob('parse', lib.id)
      }
    }
    this.identifier.start()
    this.queue.start()
    for (const lib of this.libraries.list()) this.startWatching(lib)
  }

  /** 停止任务和监听，关闭数据库。 */
  async close(): Promise<void> {
    this.watcher?.close()
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
    return this.libraries.list().map(toLibraryInfo)
  }

  /** 添加媒体库并立即排一次整库扫描。 */
  async addLibrary(
    request: LibraryRpcMap['addLibrary']['params']
  ): Promise<LibraryInfo> {
    const lib = this.libraries.add(request, Date.now())
    this.enqueueScan({ libraryId: lib.id }, PRIORITY.scan)
    this.emitLibraries()
    this.startWatching(lib)
    return toLibraryInfo(lib)
  }

  /** 删除媒体库及其全部数据。 */
  async removeLibrary({ libraryId }: { libraryId: number }): Promise<void> {
    this.watcher?.unwatch(libraryId)
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

  // —————————————————————————— 内部 ——————————————————————————

  private emit(event: LibraryEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private emitLibraries(): void {
    this.emit({ type: 'libraries-changed', libraries: this.listLibraries() })
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

  private enqueueLibraryJob(
    type: 'parse' | 'fingerprint',
    libraryId: number
  ): void {
    this.queue.enqueue({
      type,
      key: `${type}:${libraryId}`,
      payload: { libraryId } satisfies LibraryPayload,
      priority: PRIORITY[type],
    })
  }

  private startWatching(lib: LibraryRecord): void {
    if (!this.watcher) return
    try {
      this.watcher.watch(lib.id, lib.root)
    } catch (error) {
      this.log(
        `无法监听 ${lib.root}：${(error as Error).message}，仅支持手动扫描`
      )
    }
  }

  /** 监听到变化：重读涉及的目录；dirs 为 null（事件丢失）时整库扫描。 */
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
