/**
 * 调度租约：同一个数据目录只让一个服务实例跑追更 / 洗版 / 电影追踪的定时任务。
 *
 * 租约文件 <dataDir>/scheduler.lock 里是 { owner, at }：
 * - 文件不存在时用独占创建（wx）抢；
 * - 已存在但 at 超过 ttl 没续（持有者崩了 / 被杀）时视为过期，先改名挪走再独占创建，只有一个实例能挪成功；
 * - 持有者每 ttl/3 续一次；续之前核对文件里仍是自己，不是就放手（另一个实例已接管）；
 * - 正常退出时删掉（只删自己的）。
 * 不同主机共享同一个网络卷时也成立（不依赖 pid 是否存活），代价是持有者崩溃后最多 ttl 才被接管。
 */
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
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
    const current = this.read()
    if (
      current &&
      current.owner !== this.owner &&
      this.now() - current.at < this.ttlMs
    )
      return false
    if (current) {
      // 过期（或文件损坏）：挪走后再独占创建；挪失败说明别的实例先动了手
      const stale = `${this.options.file}.${this.owner.replace(/[^\w.-]/g, '_')}.stale`
      try {
        renameSync(this.options.file, stale)
        rmSync(stale, { force: true })
      } catch {
        return false
      }
    }
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

  /** 续租；文件里已不是自己时放手并返回 false */
  renew(): boolean {
    if (!this.holding) return false
    const current = this.read()
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
    if (this.read()?.owner === this.owner)
      rmSync(this.options.file, { force: true })
  }

  private record(): LeaseRecord {
    return { owner: this.owner, at: this.now() }
  }

  /** 读租约文件；不存在为 null，损坏时当作已过期的空记录 */
  private read(): LeaseRecord | null {
    let text: string
    try {
      text = readFileSync(this.options.file, 'utf8')
    } catch {
      return null
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
