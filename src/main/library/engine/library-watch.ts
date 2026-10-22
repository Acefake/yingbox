/**
 * 媒体库发现变化的全部入口，由 LibraryService 持有：
 * - 存储判定（本地盘 / 网盘，engine/storage-mode.ts）；
 * - 目录监控（fs.watch + 定时增量扫描，网盘模式两者都不用，engine/library-monitor.ts）；
 * - 外部变更通知（去抖合并后按目录扫描，engine/external-changes.ts）；
 * - 写入稳定判定（还在复制的文件过一会儿定向复扫，scanner/settle.ts）。
 * 最终都落到 requestScan(libraryId, dirs)：dirs 为 null 是整库增量扫描。
 */
import type {
  NotifyChangesRequest,
  NotifyChangesResult,
} from '../../../shared/library/ipc'
import type { LibraryRecord } from '../libraries/library-store'
import { pathKey } from '../scanner/rules'
import { SettleTracker } from '../scanner/settle'
import { ExternalChanges } from './external-changes'
import { LibraryMonitor } from './library-monitor'
import type { LibraryServiceOptions } from './service-options'
import { StorageModes } from './storage-mode'

/** 媒体库的变化入口。 */
export class LibraryWatch {
  readonly storage: StorageModes
  private readonly monitor: LibraryMonitor
  private readonly external: ExternalChanges
  private readonly settle = new Map<number, SettleTracker>()
  private readonly settleMs: number

  /** 监控相关的服务参数：watch / watchMode / scanIntervalMs / watchQuietMs / settleMs / notifyQuietMs / detectFs。 */
  constructor(
    options: LibraryServiceOptions,
    private readonly log: (message: string) => void,
    private readonly libraries: () => LibraryRecord[],
    requestScan: (libraryId: number, dirs: string[] | null) => void
  ) {
    this.settleMs = options.settleMs ?? 0
    this.storage = new StorageModes(options.detectFs)
    this.monitor = new LibraryMonitor(
      {
        mode: options.watch === false ? 'off' : (options.watchMode ?? 'auto'),
        pollIntervalMs: options.scanIntervalMs ?? 0,
        quietMs: options.watchQuietMs,
        log,
      },
      requestScan
    )
    // 关了「监控文件夹」的库只在手动扫描时入库，外部通知也不收
    this.external = new ExternalChanges(
      () => this.libraries().filter(lib => lib.automation.watch),
      requestScan,
      { quietMs: options.notifyQuietMs }
    )
  }

  /** 按库设置开始监控（catchUp：本地盘立即补一次增量扫描；网盘不补）。 */
  start(lib: LibraryRecord, catchUp: boolean): void {
    if (!lib.automation.watch) return
    void this.storage
      .isCloud(lib)
      .then(cloud => this.monitor.add(lib.id, lib.root, catchUp, cloud))
      .catch(error => {
        this.log(`监控 ${lib.root} 失败：${(error as Error).message}`)
      })
  }

  /** 设置变了：按新设置重新开始监控（补一次增量扫描）。 */
  restart(lib: LibraryRecord): void {
    this.monitor.remove(lib.id)
    this.start(lib, true)
  }

  /** 库被删除：停止监控、丢弃待交通知与写入判定。 */
  remove(libraryId: number): void {
    this.monitor.remove(libraryId)
    this.external.forget(libraryId)
    this.settle.delete(libraryId)
  }

  /** 还在写入的文件：delayMs 后对这些目录定向复扫。 */
  recheck(libraryId: number, dirs: string[], delayMs: number): void {
    this.monitor.recheck(libraryId, dirs, delayMs)
  }

  /** 外部变更通知。 */
  notify(request: NotifyChangesRequest): NotifyChangesResult {
    return this.external.push(request)
  }

  /** 这个库是否按网盘处理。 */
  isCloud(lib: LibraryRecord): Promise<boolean> {
    return this.storage.isCloud(lib)
  }

  /** 路径所在的库是否按网盘处理；不在任何库下按本地处理。 */
  isCloudPath(path: string): Promise<boolean> {
    const key = pathKey(path)
    const lib = this.libraries().find(
      l => key === l.rootKey || key.startsWith(`${l.rootKey}/`)
    )
    return lib ? this.storage.isCloud(lib) : Promise.resolve(false)
  }

  /** 这个库的写入稳定判定（settleMs 为 0 时不判定）。 */
  settleFor(lib: LibraryRecord): {
    tracker: SettleTracker
    initial: boolean
  } | null {
    if (this.settleMs <= 0) return null
    let tracker = this.settle.get(lib.id)
    if (!tracker) {
      tracker = new SettleTracker(this.settleMs)
      this.settle.set(lib.id, tracker)
    }
    return { tracker, initial: lib.lastScanAt === null }
  }

  /** 停止全部监控，丢弃待交通知。 */
  close(): void {
    this.monitor.close()
    this.external.close()
  }
}
