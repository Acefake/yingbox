/**
 * 文件写入稳定判定：还在复制 / 下载中的视频先不入库，等大小和 mtime 一段时间不变再收。
 *
 * 只看 mtime 不够：SMB 客户端、`cp -p`、部分下载器会先设好 mtime 再慢慢写内容，mtime 很旧但
 * 大小还在涨。所以“新到”的文件要两次观察（间隔不少于 settleMs）大小与 mtime 都没变才算稳定。
 * 例外是媒体库第一次扫描：那时磁盘上的存量文件没有“上一次观察”，只要 mtime 早于 settleMs 就收，
 * 否则首扫上万个文件都要白等一轮。
 *
 * 观察记录只在内存里：重启后丢失只会让新文件多等一轮，不影响正确性。
 */

/** 一次观察到的文件状态。 */
interface Observation {
  size: number
  mtime: number
  /** 第一次看到这个 size / mtime 的时间。 */
  seenAt: number
}

/** 判定所需的文件形状。 */
export interface SettleCandidate {
  key: string
  size: number
  mtime: number
}

/** 判定结果：stable 收；否则 retryInMs 后再看。 */
export type SettleVerdict =
  | { stable: true }
  | { stable: false; retryInMs: number }

/** 观察记录多久没再见到就丢弃（文件复制到一半被删掉的情况）。 */
const FORGET_AFTER_FACTOR = 20

/** 一个媒体库的写入稳定判定器。 */
export class SettleTracker {
  private readonly seen = new Map<string, Observation>()

  /** @param settleMs 大小 / mtime 至少保持多久不变才算写完；0 表示不判定、全部视为稳定。 */
  constructor(readonly settleMs: number) {}

  /** 正在观察（尚未稳定）的文件数。 */
  get pending(): number {
    return this.seen.size
  }

  /**
   * 判定一个新增或变化的文件。
   * @param initial 媒体库首扫：没有上一次观察时按 mtime 年龄判定
   */
  check(file: SettleCandidate, now: number, initial: boolean): SettleVerdict {
    if (this.settleMs <= 0) return { stable: true }
    const prev = this.seen.get(file.key)
    if (prev && prev.size === file.size && prev.mtime === file.mtime) {
      const waited = now - prev.seenAt
      if (waited >= this.settleMs) {
        this.seen.delete(file.key)
        return { stable: true }
      }
      return { stable: false, retryInMs: this.settleMs - waited }
    }
    if (!prev && initial && now - file.mtime >= this.settleMs) {
      return { stable: true }
    }
    this.seen.set(file.key, { size: file.size, mtime: file.mtime, seenAt: now })
    return { stable: false, retryInMs: this.settleMs }
  }

  /** 丢掉很久没再见到的观察记录。 */
  prune(now: number): void {
    const limit = this.settleMs * FORGET_AFTER_FACTOR
    for (const [key, obs] of this.seen) {
      if (now - obs.seenAt > limit) this.seen.delete(key)
    }
  }
}
