/**
 * 媒体库存储判定：一个库按本地盘还是网盘（挂载盘）处理。
 *
 * - 用户指定（automation.storage 为 local / cloud）直接用；
 * - auto：根目录是 UNC 网络路径（\\server\share、//server/share），或在事件不可靠的文件系统上
 *   （Linux 的 nfs / cifs / fuse / 9p …，与目录监控同一判定，见 scanner/fs-type.ts）判为网盘。
 *   Windows 上 CloudDrive2 / rclone 挂出来的盘符判不出来，要用户手动选网盘。
 *
 * 网盘的后果见 LibraryStorage：不定时扫描、不靠文件系统事件、不读视频内容。
 * auto 的判定按根目录缓存（库存在期间根目录所在的文件系统不会变）。
 */
import type { LibraryStorage } from '../../../shared/library/ipc'
import { detectUnreliableFs } from '../scanner/fs-type'

/** UNC 路径（Windows 网络共享）。 */
export function isNetworkPath(path: string): boolean {
  return /^(?:\\\\|\/\/)[^\\/]/.test(path)
}

/** 判定需要的库字段。 */
export interface StorageTarget {
  root: string
  automation: { storage: LibraryStorage }
}

/** 存储判定（按根目录缓存 auto 的结果）。 */
export class StorageModes {
  private readonly pending = new Map<string, Promise<boolean>>()
  private readonly settled = new Map<string, boolean>()

  constructor(
    private readonly detectFs: (
      root: string
    ) => Promise<string | undefined> = root => detectUnreliableFs(root)
  ) {}

  /** 这个库是否按网盘处理。 */
  isCloud(lib: StorageTarget): Promise<boolean> {
    const { storage } = lib.automation
    if (storage !== 'auto') return Promise.resolve(storage === 'cloud')
    let found = this.pending.get(lib.root)
    if (!found) {
      found = isNetworkPath(lib.root)
        ? Promise.resolve(true)
        : this.detectFs(lib.root).then(Boolean, () => false)
      found = found.then(cloud => {
        this.settled.set(lib.root, cloud)
        return cloud
      })
      this.pending.set(lib.root, found)
    }
    return found
  }

  /** 已经有结论时同步给出（列表展示用）；auto 还没判定完返回 undefined。 */
  known(lib: StorageTarget): boolean | undefined {
    const { storage } = lib.automation
    if (storage !== 'auto') return storage === 'cloud'
    return this.settled.get(lib.root)
  }
}
