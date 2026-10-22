/**
 * 外部文件变更通知 → 按目录增量扫描。
 *
 * 通知来自主进程的本地 HTTP 端点（CloudDrive2 文件变更 webhook 或通用 JSON，见 src/main/library/notify）。
 * 网盘模式的库不跑定时扫描、不靠 fs.watch，靠这里入库；本地库收到通知同样处理（多一次定向扫描无害）。
 *
 * 1. 路径对应到库：通知里的路径可能是本机路径，也可能是网盘工具自己的路径（CloudDrive2 的
 *    /115/电影/A.mkv，挂载在 D:\CloudDrive 时本机是 D:\CloudDrive\115\电影\A.mkv）。依次尝试：
 *    mountRoot + 路径 落在某个库下；路径本身落在某个库下；库目录末尾几段 = 路径开头几段
 *    （D:\CloudDrive\115\电影 对上 /115/电影/…，取对上段数最多的库，并列视为对不上）。
 * 2. 变化 → 目录：变化项的父目录（新目录由父目录 readdir 发现并完整下钻，与 fs.watch 通道相同）；
 *    改名 / 移动两头的父目录都要；变化项就是库根目录时扫根目录。
 * 3. 去抖合并：每个库一个合批器，静默 quietMs（默认 2 秒）后交出，同目录只算一次；
 *    持续有通知时最长 maxWaitMs 交一次。
 */
import { dirname, join } from 'node:path'
import type {
  FileChangeNotice,
  NotifyChangesRequest,
  NotifyChangesResult,
} from '../../../shared/library/ipc'
import { KeyedBatcher } from '../scanner/batcher'
import { pathKey } from '../scanner/rules'

/** 通知合批的静默时间。 */
export const NOTIFY_QUIET_MS = 2000
/** 持续有通知时最长多久交一批。 */
export const NOTIFY_MAX_WAIT_MS = 10_000

/** 对应需要的库字段。 */
export interface ExternalLibrary {
  id: number
  root: string
}

/** 路径对应到的库与本机路径。 */
export interface MappedPath {
  libraryId: number
  root: string
  path: string
}

const segments = (path: string): string[] =>
  path.split(/[\\/]+/).filter(Boolean)

/** 路径本身落在哪个库下（含库根目录本身）。 */
function containing(
  path: string,
  libraries: readonly ExternalLibrary[]
): MappedPath | null {
  const key = pathKey(path)
  for (const lib of libraries) {
    const root = pathKey(lib.root)
    if (key === root || key.startsWith(`${root}/`))
      return { libraryId: lib.id, root: lib.root, path }
  }
  return null
}

/** 库目录末尾 k 段 = 路径开头 k 段，取 k 最大的库；并列或对不上返回 null。 */
function bySuffix(
  path: string,
  libraries: readonly ExternalLibrary[]
): MappedPath | null {
  const parts = segments(path)
  const keys = parts.map(pathKey)
  let best: { lib: ExternalLibrary; k: number } | null = null
  let tie = false
  for (const lib of libraries) {
    const root = segments(lib.root).map(pathKey)
    let k = Math.min(root.length, keys.length)
    while (k > 0 && root.slice(-k).join('/') !== keys.slice(0, k).join('/')) k--
    if (!k || (best && k < best.k)) continue
    tie = best?.k === k
    best = { lib, k }
  }
  if (!best || tie) return null
  const rest = parts.slice(best.k)
  return {
    libraryId: best.lib.id,
    root: best.lib.root,
    path: rest.length ? join(best.lib.root, ...rest) : best.lib.root,
  }
}

/** 通知里的一个路径 → 库与本机路径；对不上任何库返回 null。 */
export function mapNoticePath(
  path: string,
  libraries: readonly ExternalLibrary[],
  mountRoot?: string
): MappedPath | null {
  if (mountRoot) {
    const mounted = containing(join(mountRoot, ...segments(path)), libraries)
    if (mounted) return mounted
  }
  return containing(path, libraries) ?? bySuffix(path, libraries)
}

/** 一个对应好的路径要重读的目录：父目录；本身就是库根目录时是根目录。 */
function dirToScan(mapped: MappedPath): string {
  return pathKey(mapped.path) === pathKey(mapped.root)
    ? mapped.root
    : dirname(mapped.path)
}

/** 外部变更通知的去抖合并。 */
export class ExternalChanges {
  private readonly batchers = new Map<number, KeyedBatcher<string>>()

  constructor(
    private readonly libraries: () => readonly ExternalLibrary[],
    private readonly requestScan: (libraryId: number, dirs: string[]) => void,
    private readonly options: { quietMs?: number; maxWaitMs?: number } = {}
  ) {}

  /** 收下一批通知；返回对应上 / 对不上的条数。 */
  push(request: NotifyChangesRequest): NotifyChangesResult {
    const libs = this.libraries()
    let accepted = 0
    for (const notice of request.changes) {
      const dirs = this.dirsOf(notice, libs, request.mountRoot)
      if (dirs.length) accepted++
      for (const [libraryId, dir] of dirs)
        this.batcher(libraryId).push(pathKey(dir), dir)
    }
    return { accepted, ignored: request.changes.length - accepted }
  }

  /** 丢弃某个库的待交通知（库被删除）。 */
  forget(libraryId: number): void {
    this.batchers.get(libraryId)?.dispose()
    this.batchers.delete(libraryId)
  }

  /** 丢弃全部待交通知。 */
  close(): void {
    for (const id of [...this.batchers.keys()]) this.forget(id)
  }

  private dirsOf(
    notice: FileChangeNotice,
    libs: readonly ExternalLibrary[],
    mountRoot: string | undefined
  ): Array<[number, string]> {
    const out: Array<[number, string]> = []
    for (const path of [notice.path, notice.destination]) {
      if (!path) continue
      const mapped = mapNoticePath(path, libs, mountRoot)
      if (mapped) out.push([mapped.libraryId, dirToScan(mapped)])
    }
    return out
  }

  private batcher(libraryId: number): KeyedBatcher<string> {
    let batcher = this.batchers.get(libraryId)
    if (!batcher) {
      batcher = new KeyedBatcher<string>(
        dirs => this.requestScan(libraryId, dirs),
        {
          quietMs: this.options.quietMs ?? NOTIFY_QUIET_MS,
          maxWaitMs: this.options.maxWaitMs ?? NOTIFY_MAX_WAIT_MS,
        }
      )
      this.batchers.set(libraryId, batcher)
    }
    return batcher
  }
}
