/**
 * 调度租约：同一个数据目录只让一个服务实例跑追更 / 洗版 / 电影追踪的定时任务。
 *
 * 租约文件 <dataDir>/scheduler.lock 里是 { owner, at }：
 * - 文件不存在时用独占创建（wx）抢；
 * - 已存在但 at 超过 ttl 没续（持有者崩了 / 被杀）时视为过期，先改名挪走再独占创建，只有一个实例能挪成功；
 *   挪走后核对挪走的正是刚才判过期的那份：两个实例同时判过期时，后挪的那个可能挪走了先到者刚建的新租约，
 *   这时放回去并让出，不会两边同时持有；
 * - 空文件是别的实例刚独占创建、还没写完内容：按文件修改时间算租期，不当作损坏抢走；
 * - 持有者每 ttl/3 续一次；续之前核对文件里仍是自己，不是就放手（另一个实例已接管）；
 * - 正常退出时删掉（只删自己的）。
 * 不同主机共享同一个网络卷时也成立（不依赖 pid 是否存活），代价是持有者崩溃后最多 ttl 才被接管。
 */
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { hostname } from 'node:os'

/** 默认租期：90 秒 */
export const LEASE_TTL_MS = 90_000

/** 租约文件内容 */
interface LeaseRecord {
  owner: string
  at: number
}

/** 选项 */
export interface LeaseOptions {
  file: string
  ttlMs?: number
  now?: () => number
  /** 持有者标识（缺省：主机名 + pid + 随机串） */
  owner?: string
}

/** 调度租约 */
export class SchedulerLease {
  readonly owner: string
  readonly ttlMs: number
  private readonly now: () => number
  private holding = false

  constructor(private readonly options: LeaseOptions) {
    this.owner =
      options.owner ??
      `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`
    this.ttlMs = options.ttlMs ?? LEASE_TTL_MS
    this.now = options.now ?? Date.now
  }

  /** 是否持有 */
  get held(): boolean {
    return this.holding
  }

  /** 试着取得租约（已持有时等同续租）；返回是否持有 */
  tryAcquire(): boolean {
    if (this.holding) return this.renew()
    const seen = this.readText()
    const current = seen === null ? null : this.parse(seen)
    if (
      current &&
      current.owner !== this.owner &&
      this.now() - current.at < this.ttlMs
    )
      return false
    // 过期（或文件损坏）：挪走后再独占创建；挪失败说明别的实例先动了手
    if (seen !== null && !this.takeOver(seen)) return false
    try {
      const fd = openSync(this.options.file, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify(this.record()))
      } finally {
        closeSync(fd)
      }
    } catch {
      return false
    }
    this.holding = true
    return true
  }

  /**
   * 挪走判过期的租约文件。挪走的内容与判过期时读到的不同，说明这期间别的实例已换上新租约：
   * 放回去（独占，不覆盖又一个新建的）并返回 false。
   */
  private takeOver(seen: string): boolean {
    const { file } = this.options
    const stale = `${file}.${this.owner.replace(/[^\w.-]/g, '_')}.stale`
    try {
      renameSync(file, stale)
    } catch {
      return false
    }
    let moved: string | null = null
    try {
      moved = readFileSync(stale, 'utf8')
    } catch {
      /* 读不到当作不同 */
    }
    if (moved === seen) {
      rmSync(stale, { force: true })
      return true
    }
    restoreExclusive(stale, file, moved)
    rmSync(stale, { force: true })
    return false
  }

  /** 续租；文件里已不是自己时放手并返回 false */
  renew(): boolean {
    if (!this.holding) return false
    const text = this.readText()
    const current = text === null ? null : this.parse(text)
    if (!current || current.owner !== this.owner) {
      this.holding = false
      return false
    }
    try {
      writeFileSync(this.options.file, JSON.stringify(this.record()), {
        mode: 0o600,
      })
    } catch {
      this.holding = false
    }
    return this.holding
  }

  /** 放手（只删自己的租约文件） */
  release(): void {
    if (!this.holding) return
    this.holding = false
    const text = this.readText()
    if (text !== null && this.parse(text).owner === this.owner)
      rmSync(this.options.file, { force: true })
  }

  private record(): LeaseRecord {
    return { owner: this.owner, at: this.now() }
  }

  /** 读租约文件原文；不存在为 null */
  private readText(): string | null {
    try {
      return readFileSync(this.options.file, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * 解析租约内容：损坏时当作已过期的空记录；
   * 空文件是别的实例独占创建后还没写完，按文件修改时间算（读不到时间时当作刚建）。
   */
  private parse(text: string): LeaseRecord {
    if (!text) {
      let at = this.now()
      try {
        at = statSync(this.options.file).mtimeMs
      } catch {
        /* 文件已被挪走：当作刚建 */
      }
      return { owner: '', at }
    }
    try {
      const data = JSON.parse(text) as Partial<LeaseRecord>
      if (typeof data.owner === 'string' && typeof data.at === 'number')
        return { owner: data.owner, at: data.at }
    } catch {
      /* 损坏 */
    }
    return { owner: '', at: 0 }
  }
}

/** 把挪走的租约放回原处，已有新文件时不覆盖；文件系统不支持硬链接时退回独占写入 */
function restoreExclusive(
  from: string,
  to: string,
  content: string | null
): void {
  try {
    linkSync(from, to)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
  }
  if (content === null) return
  try {
    writeFileSync(to, content, { flag: 'wx', mode: 0o600 })
  } catch {
    /* 又有实例建了新的：原持有者续租时会发现 */
  }
}
