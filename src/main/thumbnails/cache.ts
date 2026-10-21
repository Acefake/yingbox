/**
 * 缩略图磁盘缓存（userData/thumb-cache）：文件名 = sha1(来源 + 宽度).webp，按最近使用淘汰。
 *
 * - 索引在内存里：首次使用时扫一遍目录（文件大小 + mtime），之后随读写更新，不再每次 readdir。
 * - 「最近使用」就是文件 mtime：命中时如果距上次标记超过 TOUCH_INTERVAL_MS 才 utimes，减少写盘。
 * - 写入先写临时文件再 rename（原子），写完若总量超上限，按最久未用删到上限的 90%。
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

/** 默认容量上限：256 MB（720px WebP 约 60–150 KB，够存几千张） */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
/** 命中后多久内不重复更新 mtime */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface CacheEntry {
  name: string
  size: number
  /** 最近使用时间（毫秒） */
  usedAt: number
}

/** 缓存文件名：来源 + 宽度的 sha1 */
export function thumbKey(source: string, width: number): string {
  return `${createHash('sha1').update(`${width}\n${source}`).digest('hex')}.webp`
}

/**
 * 超过上限时要删哪些：按最久未用先删，删到 maxBytes × lowWater 以下。
 * keep 里的条目（刚写入的）不删。
 */
export function planEviction(
  entries: readonly CacheEntry[],
  maxBytes: number,
  keep: ReadonlySet<string> = new Set(),
  lowWater = 0.9
): string[] {
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total <= maxBytes) return []
  const target = maxBytes * lowWater
  const victims: string[] = []
  const oldestFirst = [...entries].sort((a, b) => a.usedAt - b.usedAt)
  for (const entry of oldestFirst) {
    if (total <= target) break
    if (keep.has(entry.name)) continue
    victims.push(entry.name)
    total -= entry.size
  }
  return victims
}

export class ThumbCache {
  private index: Map<string, CacheEntry> | null = null
  private loading: Promise<Map<string, CacheEntry>> | null = null

  constructor(
    readonly dir: string,
    readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly now: () => number = Date.now
  ) {}

  /** 读一张；不存在返回 null。命中时按需刷新最近使用时间 */
  async get(name: string): Promise<Buffer | null> {
    const index = await this.load()
    const entry = index.get(name)
    if (!entry) return null
    try {
      const data = await readFile(join(this.dir, name))
      const now = this.now()
      if (now - entry.usedAt > TOUCH_INTERVAL_MS) {
        entry.usedAt = now
        const time = new Date(now)
        await utimes(join(this.dir, name), time, time).catch(() => {})
      }
      return data
    } catch {
      index.delete(name)
      return null
    }
  }

  /** 写一张（原子），然后按上限淘汰 */
  async put(name: string, data: Uint8Array): Promise<void> {
    const index = await this.load()
    await mkdir(this.dir, { recursive: true })
    const temporary = join(this.dir, `${name}.${randomUUID()}.tmp`)
    await writeFile(temporary, data)
    await rename(temporary, join(this.dir, name))
    index.set(name, { name, size: data.byteLength, usedAt: this.now() })
    const victims = planEviction(
      [...index.values()],
      this.maxBytes,
      new Set([name])
    )
    for (const victim of victims) {
      index.delete(victim)
      await rm(join(this.dir, victim), { force: true })
    }
  }

  /** 当前占用（字节），测试与诊断用 */
  async size(): Promise<number> {
    const index = await this.load()
    let total = 0
    for (const entry of index.values()) total += entry.size
    return total
  }

  private async load(): Promise<Map<string, CacheEntry>> {
    if (this.index) return this.index
    this.loading ??= this.scan()
    this.index = await this.loading
    return this.index
  }

  private async scan(): Promise<Map<string, CacheEntry>> {
    const index = new Map<string, CacheEntry>()
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      return index
    }
    for (const name of names) {
      const full = join(this.dir, name)
      // 上次异常退出留下的临时文件直接清掉
      if (name.endsWith('.tmp')) {
        await rm(full, { force: true })
        continue
      }
      if (!name.endsWith('.webp')) continue
      try {
        const info = await stat(full)
        index.set(name, { name, size: info.size, usedAt: info.mtimeMs })
      } catch {
        // 扫描期间被删，忽略
      }
    }
    return index
  }
}
