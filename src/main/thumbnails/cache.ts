/**
 * 缩略图磁盘缓存（<mediaDir>/thumb/<key 前两位>/<文件>），按最近使用淘汰。
 *
 * - 索引在内存里：首次使用时扫一遍两级目录（文件大小 + mtime），之后随读写更新，不再每次 readdir。
 * - 「最近使用」就是文件 mtime：命中时如果距上次标记超过 TOUCH_INTERVAL_MS 才 utimes，减少写盘。
 * - 写入先写临时文件再 rename（原子），写完若总量超上限，按最久未用删到上限的 90%。
 */
import { randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 默认容量上限：512 MB。媒体库每部影片两档（300w ≈ 25 KB、780w ≈ 90 KB），
 * 加上在线 / AV 封面，够存几千部；淘汰的媒体库缩略图会从原图重新生成。
 */
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
/** 命中后多久内不重复更新 mtime */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000

/** 文件是否存在。 */
export const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

export interface CacheEntry {
  /** 相对缓存目录的路径 */
  name: string
  size: number
  /** 最近使用时间（毫秒） */
  usedAt: number
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

  /**
   * 缓存里有这张就返回绝对路径（并按需刷新最近使用时间），没有返回 null。
   * 文件被外部删掉时从索引里去掉，返回 null（调用方重新生成）。
   */
  async find(name: string): Promise<string | null> {
    const index = await this.load()
    const entry = index.get(name)
    if (!entry) return null
    const path = join(this.dir, name)
    if (!(await exists(path))) {
      index.delete(name)
      return null
    }
    const now = this.now()
    if (now - entry.usedAt > TOUCH_INTERVAL_MS) {
      entry.usedAt = now
      const time = new Date(now)
      await utimes(path, time, time).catch(() => {})
    }
    return path
  }

  /** 写一张（原子），然后按上限淘汰；返回绝对路径。 */
  async put(name: string, data: Uint8Array): Promise<string> {
    const index = await this.load()
    const path = join(this.dir, name)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, data)
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
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
    return path
  }

  /** 当前占用（字节），测试与诊断用 */
  async size(): Promise<number> {
    let total = 0
    for (const entry of (await this.load()).values()) total += entry.size
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
    const list = (dir: string): Promise<string[]> =>
      readdir(dir).catch(() => [])
    for (const shard of await list(this.dir)) {
      for (const file of await list(join(this.dir, shard))) {
        const name = join(shard, file)
        const full = join(this.dir, name)
        // 上次异常退出留下的临时文件直接清掉
        if (file.endsWith('.tmp') || file.endsWith('.partial')) {
          await rm(full, { force: true })
          continue
        }
        if (!/\.(webp|jpg)$/.test(file)) continue
        try {
          const info = await stat(full)
          index.set(name, { name, size: info.size, usedAt: info.mtimeMs })
        } catch {
          // 扫描期间被删，忽略
        }
      }
    }
    return index
  }
}
