/**
 * 文件系统事件：Node 内置 fs.watch(root, { recursive: true })。
 *
 * Windows 上是一个 ReadDirectoryChangesW 句柄、macOS 上是 FSEvents，整棵树只占一个句柄，
 * 不用逐目录注册（chokidar v4 不用 recursive 模式，每个目录一个 fs.watch，万级目录就是万级句柄）；
 * Linux 上 Node 用 inotify 逐目录模拟，每个目录占一个 watch，受 fs.inotify.max_user_watches 限制，
 * 满了会报 ENOSPC；NFS / SMB / FUSE 挂载上别的机器写入的文件不产生事件。这些情况由
 * engine/library-monitor 退回定时增量扫描。不引入原生依赖（@parcel/watcher 会被 postinstall 的
 * electron-builder install-app-deps 拿去 node-gyp 重编，没有编译工具链就装不上）。
 *
 * 事件去抖合批后转换成“需要重读的目录”，交给增量扫描。监听是加速手段，不是正确性的依据：
 * 事件丢失（网络盘、缓冲区溢出、休眠唤醒）时，定时增量扫描仍会靠目录 mtime 对齐；
 * 系统报告溢出（filename 为空）时直接排整库扫描。启动失败直接抛出、运行中出错走 onError，
 * 由调用方决定降级。
 */
import { type FSWatcher, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { KeyedBatcher } from './batcher'
import { fileKindOf, isIgnoredName, pathKey } from './rules'

/**
 * 一个媒体库的变化：需要重读的目录（原始路径）；为 null 表示事件丢失，需要整库扫描。
 */
export type WatchCallback = (libraryId: number, dirs: string[] | null) => void

/** fs.watch 报告的一个变化：rename 是新建 / 删除 / 改名，change 是内容修改。 */
export interface WatchChange {
  type: 'rename' | 'change'
  /** 变化项的绝对路径。 */
  path: string
}

/** 路径上任何一段是忽略名（隐藏目录、@eaDir、回收站）就不关心。 */
function inIgnoredDir(path: string): boolean {
  return path
    .split(/[\\/]/)
    .some(segment => segment !== '' && isIgnoredName(segment.toLowerCase()))
}

/**
 * 判断变化是否可能影响媒体库：rename 不知道是文件还是目录、是增还是删，只要不在忽略目录里就算；
 * change 只关心收录的文件类型（视频、nfo、图片）。
 */
export function isRelevantChange(change: WatchChange): boolean {
  if (inIgnoredDir(change.path)) return false
  if (change.type === 'rename') return true
  const name = change.path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return fileKindOf(name) !== undefined
}

/** 变化 → 需要重读的目录：项所在的父目录（新目录由父目录 readdir 发现并完整下钻）。 */
export function dirsForChanges(
  changes: readonly WatchChange[]
): Map<string, string> {
  const dirs = new Map<string, string>()
  for (const change of changes) {
    if (!isRelevantChange(change)) continue
    const dir = dirname(change.path)
    dirs.set(pathKey(dir), dir)
  }
  return dirs
}

/** 合批里代表“整库扫描”的键。 */
const FULL_SCAN = '\0full'

/** 多个媒体库的监听管理。 */
export class LibraryWatcher {
  private readonly watchers = new Map<number, FSWatcher>()
  private readonly batchers = new Map<number, KeyedBatcher<string>>()

  constructor(
    private readonly onChange: WatchCallback,
    private readonly onError: (libraryId: number, error: Error) => void,
    private readonly quietMs = 1000
  ) {}

  /** 开始监听一个媒体库根目录；已在监听时什么都不做。根目录不存在等错误直接抛出。 */
  watch(libraryId: number, root: string): void {
    if (this.watchers.has(libraryId)) return
    const batcher = new KeyedBatcher<string>(
      dirs => this.onChange(libraryId, dirs.includes(FULL_SCAN) ? null : dirs),
      { quietMs: this.quietMs }
    )
    const watcher = watch(
      root,
      { recursive: true, persistent: false },
      (type, filename) => {
        if (!filename) {
          batcher.push(FULL_SCAN, FULL_SCAN)
          return
        }
        const change: WatchChange = {
          type: type === 'change' ? 'change' : 'rename',
          path: join(root, filename.toString()),
        }
        for (const [key, dir] of dirsForChanges([change]))
          batcher.push(key, dir)
      }
    )
    watcher.on('error', error => this.onError(libraryId, error))
    this.watchers.set(libraryId, watcher)
    this.batchers.set(libraryId, batcher)
  }

  /** 停止监听一个媒体库。 */
  unwatch(libraryId: number): void {
    this.batchers.get(libraryId)?.dispose()
    this.batchers.delete(libraryId)
    this.watchers.get(libraryId)?.close()
    this.watchers.delete(libraryId)
  }

  /** 停止全部监听。 */
  close(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id)
  }
}
