/**
 * 媒体库监控：决定每个库靠什么发现变化，并把“该扫哪里”交给服务层排扫描任务。
 *
 * 两条通道，正确性只靠第二条：
 * 1. 文件系统事件（LibraryWatcher，fs.watch recursive）：快，秒级入库。Windows / macOS 一个句柄管整棵树；
 *    Linux 上每个目录一个 inotify watch，受 fs.inotify.max_user_watches 限制（满了报 ENOSPC）。
 * 2. 定时增量扫描：每 pollIntervalMs 对整库做一次增量扫描（目录 mtime 短路，无变化时只 stat 目录）。
 *    网络盘（NFS / SMB / FUSE / 9p）上别的机器写入的文件没有事件、事件缓冲溢出、休眠唤醒，都由它兜住。
 *
 * 网盘模式的库（见 engine/storage-mode.ts）两条都不用：通道记为 external，只靠外部变更通知
 * （engine/external-changes.ts）和手动扫描，启动时也不补扫——网盘上整库遍历是一次大规模网络列目录。
 *
 * 模式（只管本地盘；网盘模式的库在任何模式下都是 external）：
 * - auto（默认）：本地盘用事件 + 定时扫描；网络盘（存储改选「本地盘」时）或事件启动失败 / 运行中出错时只用定时扫描；
 * - events：总是尝试事件（失败仍退回定时扫描），用于确认网络盘事件可用的环境；
 * - poll：只用定时扫描；
 * - off：都不用，只能手动扫描。
 *
 * 另外负责“写入未稳定”的复查：扫描时还在复制的文件过一会儿对它所在目录定向复扫（与监控开关无关，
 * 手动扫描遇到正在复制的文件也要收尾）。
 */
import { detectUnreliableFs } from '../scanner/fs-type'
import { LibraryWatcher } from '../scanner/watcher'

/** 监控模式。 */
export type WatchMode = 'auto' | 'events' | 'poll' | 'off'

/** 监控模式取值。 */
export const WATCH_MODES: readonly WatchMode[] = [
  'auto',
  'events',
  'poll',
  'off',
]

/**
 * 宿主默认的监控参数（核心 LibraryService 本身默认不做定时扫描和写入稳定判定，测试更确定）：
 * - 定时增量扫描 5 分钟一次：网络盘的唯一通道，本地盘上兜住丢失的事件；无变化时只 stat 目录；
 * - 写入稳定判定 10 秒：大小与 mtime 10 秒不变才入库，避免把复制到一半的文件拿去刮削、整理。
 */
export const DEFAULT_MONITOR: {
  readonly watchMode: WatchMode
  readonly scanIntervalMs: number
  readonly settleMs: number
} = { watchMode: 'auto', scanIntervalMs: 5 * 60_000, settleMs: 10_000 }

/** 一个库实际在用的通道：external 是网盘模式（只靠外部变更通知与手动扫描）。 */
export type MonitorChannel = 'events' | 'poll' | 'external' | 'off'

/** 监控参数。 */
export interface MonitorOptions {
  mode: WatchMode
  /** 定时增量扫描间隔；0 关闭。 */
  pollIntervalMs: number
  /** 事件去抖静默时间。 */
  quietMs?: number
  /** 判断根目录是否在事件不可靠的文件系统上（测试注入）。 */
  detectFs?: (root: string) => Promise<string | undefined>
  log: (message: string) => void
}

/** 排扫描：dirs 为 null 表示整库增量扫描。 */
export type ScanRequestFn = (libraryId: number, dirs: string[] | null) => void

interface Entry {
  root: string
  channel: MonitorChannel
  poll?: ReturnType<typeof setInterval>
}

interface Recheck {
  timer: ReturnType<typeof setTimeout>
  at: number
  dirs: Set<string>
}

/** 把 fs.watch 的错误翻译成给人看的原因。 */
export function describeWatchError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ENOSPC':
      return 'inotify 监听数达到上限（可在宿主机调大 fs.inotify.max_user_watches）'
    case 'EMFILE':
      return '打开的文件句柄过多（可调大 ulimit -n 或 fs.inotify.max_user_instances）'
    case 'ENOSYS':
    case 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM':
      return '当前系统不支持递归监听'
    default:
      return error.message
  }
}

/** 多个媒体库的监控。 */
export class LibraryMonitor {
  private readonly entries = new Map<number, Entry>()
  private readonly rechecks = new Map<number, Recheck>()
  private readonly watcher: LibraryWatcher
  private readonly detectFs: (root: string) => Promise<string | undefined>
  private closed = false

  constructor(
    private readonly options: MonitorOptions,
    private readonly requestScan: ScanRequestFn
  ) {
    this.detectFs = options.detectFs ?? (root => detectUnreliableFs(root))
    this.watcher = new LibraryWatcher(
      (id, dirs) => this.requestScan(id, dirs),
      (id, error) => this.onWatchError(id, error),
      options.quietMs
    )
  }

  /** 某个库当前在用的通道（没在监控时 off）。 */
  channel(libraryId: number): MonitorChannel {
    return this.entries.get(libraryId)?.channel ?? 'off'
  }

  /**
   * 开始监控一个库；已在监控时什么都不做。
   * @param catchUp 立即排一次整库增量扫描（启动时补上停机期间的变化）
   * @param cloud 网盘模式：不监听、不定时扫描、不补扫，通道记为 external
   */
  async add(
    libraryId: number,
    root: string,
    catchUp = false,
    cloud = false
  ): Promise<void> {
    if (this.closed || this.entries.has(libraryId)) return
    const { mode, pollIntervalMs, log } = this.options
    if (mode === 'off') return
    if (cloud) {
      this.entries.set(libraryId, { root, channel: 'external' })
      return
    }
    const entry: Entry = { root, channel: 'poll' }
    this.entries.set(libraryId, entry)
    let reason: string | undefined
    if (mode === 'auto') {
      const fs = await this.detectFs(root)
      if (this.entries.get(libraryId) !== entry) return // 等待期间被移除
      if (fs) reason = `${root} 在 ${fs} 文件系统上，收不到别的机器写入的事件`
    }
    if (mode !== 'poll' && !reason) {
      try {
        this.watcher.watch(libraryId, root)
        entry.channel = 'events'
      } catch (error) {
        reason = `无法监听 ${root}：${describeWatchError(error as NodeJS.ErrnoException)}`
      }
    }
    if (pollIntervalMs > 0) {
      entry.poll = setInterval(
        () => this.requestScan(libraryId, null),
        pollIntervalMs
      )
      entry.poll.unref?.()
    }
    if (reason) log(`${reason}，${this.pollText()}`)
    if (catchUp) this.requestScan(libraryId, null)
  }

  /** 停止监控一个库（同时取消它的待复查）。 */
  remove(libraryId: number): void {
    const entry = this.entries.get(libraryId)
    if (entry) {
      this.watcher.unwatch(libraryId)
      clearInterval(entry.poll)
      this.entries.delete(libraryId)
    }
    const recheck = this.rechecks.get(libraryId)
    if (recheck) clearTimeout(recheck.timer)
    this.rechecks.delete(libraryId)
  }

  /** delayMs 后对这些目录定向复扫；已有待复查时合并目录、取较早的时间。 */
  recheck(libraryId: number, dirs: string[], delayMs: number): void {
    if (this.closed || !dirs.length) return
    const at = Date.now() + Math.max(0, delayMs)
    const pending = this.rechecks.get(libraryId)
    if (pending && pending.at <= at) {
      for (const dir of dirs) pending.dirs.add(dir)
      return
    }
    if (pending) clearTimeout(pending.timer)
    const merged = new Set([...(pending?.dirs ?? []), ...dirs])
    const timer = setTimeout(() => {
      this.rechecks.delete(libraryId)
      this.requestScan(libraryId, [...merged])
    }, at - Date.now())
    timer.unref?.()
    this.rechecks.set(libraryId, { timer, at, dirs: merged })
  }

  /** 停止全部监控与复查。 */
  close(): void {
    this.closed = true
    for (const id of [...this.entries.keys(), ...this.rechecks.keys()]) {
      this.remove(id)
    }
    this.watcher.close()
  }

  /** 运行中事件出错（inotify 满、目录被卸载）：退回定时扫描，并立即补一次整库增量扫描。 */
  private onWatchError(libraryId: number, error: Error): void {
    const entry = this.entries.get(libraryId)
    if (!entry || entry.channel !== 'events') return
    this.watcher.unwatch(libraryId)
    entry.channel = 'poll'
    const reason = describeWatchError(error as NodeJS.ErrnoException)
    this.options.log(`监听 ${entry.root} 出错：${reason}，${this.pollText()}`)
    this.requestScan(libraryId, null)
  }

  private pollText(): string {
    const ms = this.options.pollIntervalMs
    return ms > 0
      ? `改用每 ${Math.round(ms / 1000)} 秒一次的定时扫描`
      : '定时扫描已关闭，只能手动扫描'
  }
}
