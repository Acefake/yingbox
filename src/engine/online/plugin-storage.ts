/**
 * CatSpider 插件的 `$cache`：按插件隔离、跨调用共用、持久化到 userData/online/plugin-storage/。
 *
 * 插件拿它存设备注册结果、登录 token、站点密钥（瓜子的 deviceId/token、星芽 token、iyf 密钥…）。
 * 以前每次运行插件都新建一个空 Map，所以每次搜索 / 翻页 / 播放都要重新注册设备、重新拿 token。
 *
 * - 隔离：每个插件（按脚本地址）一个文件，名字是地址 sha1 前 16 位，插件之间互相读不到；
 * - 过期：每条记写入时间，超过 ttlMs（默认 30 天）读不到，加载时顺带丢弃；
 * - 大小：每个插件序列化后最多 maxBytes（默认 256 KB），超出时从最早写入的开始淘汰；
 *   单条就超限、或不能 JSON 序列化的值只留在内存里（本次运行可读），不落盘；
 * - 原子写：先写临时文件再改名，写到一半退出也不会留下半个文件；写盘失败只影响重启后的恢复。
 * 内存里保存的是插件给的原值，同一次运行里读回来与原来一样；重启后读到的是 JSON 往返后的值。
 */
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** 注入给插件的 `$cache`。 */
export interface PluginCache {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

export interface PluginStorageOptions {
  /** 落盘目录；不给就只在内存里（跨调用共用，不跨重启） */
  dir?: string
  /** 条目有效期，默认 30 天 */
  ttlMs?: number
  /** 每个插件落盘的上限（字节，按 JSON 计），默认 256 KB */
  maxBytes?: number
  now?: () => number
}

export const PLUGIN_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const PLUGIN_STORAGE_MAX_BYTES = 256 * 1024

interface Entry {
  value: unknown
  /** 写入时间 */
  at: number
  /** 落盘用的 JSON；undefined 表示只留内存 */
  json?: string
}

/** 文件格式：{ key: { v: 值, at: 写入时间 } } */
type FileShape = Record<string, { v: unknown; at: number }>

/** 插件地址 → 文件名（不含扩展名）。 */
export function pluginStorageId(pluginUrl: string): string {
  return createHash('sha1').update(pluginUrl).digest('hex').slice(0, 16)
}

/** 插件存储：按插件地址给出各自的 `$cache`（同一地址返回同一份）。 */
export interface PluginStorage {
  forPlugin(pluginUrl: string): PluginCache
}

/** 创建插件存储。 */
export function createPluginStorage(
  options: PluginStorageOptions = {}
): PluginStorage {
  const ttl = options.ttlMs ?? PLUGIN_STORAGE_TTL_MS
  const maxBytes = options.maxBytes ?? PLUGIN_STORAGE_MAX_BYTES
  const now = options.now ?? Date.now
  const caches = new Map<string, PluginCache>()

  const fileOf = (id: string): string | undefined =>
    options.dir ? join(options.dir, `${id}.json`) : undefined

  function load(file: string | undefined): Map<string, Entry> {
    const entries = new Map<string, Entry>()
    if (!file) return entries
    try {
      // 不存在、损坏、形状不对都当作空的：只认带数字 at 的条目
      const data = JSON.parse(readFileSync(file, 'utf8')) as FileShape
      for (const [key, raw] of Object.entries(data)) {
        if (typeof raw?.at !== 'number' || now() - raw.at >= ttl) continue
        entries.set(key, {
          value: raw.v,
          at: raw.at,
          json: JSON.stringify(raw.v),
        })
      }
    } catch {
      // 读不了就从空的开始
    }
    return entries
  }

  /**
   * 按写入时间从新到旧收，收到上限为止；放不下的旧条目从内存里也淘汰，和重启后一致。
   * JSON 直接按片段拼，字节数是精确的，键是 __proto__ 也只是普通属性。
   */
  function persist(
    file: string | undefined,
    entries: Map<string, Entry>
  ): void {
    const parts: string[] = []
    let bytes = 2 // {}
    const byNewest = [...entries].sort((a, b) => b[1].at - a[1].at)
    for (const [key, entry] of byNewest) {
      if (entry.json === undefined) continue
      const part = `${JSON.stringify(key)}:{"v":${entry.json},"at":${entry.at}}`
      const size = Buffer.byteLength(part) + 1 // 加分隔的逗号
      if (size + 2 > maxBytes) continue // 单条超限：只留内存
      if (bytes + size > maxBytes) {
        entries.delete(key)
        continue
      }
      bytes += size
      parts.push(part)
    }
    if (!file) return
    try {
      if (parts.length === 0) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(options.dir as string, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, `{${parts.join(',')}}`)
      renameSync(tmp, file)
    } catch {
      // 写盘失败只影响重启后的恢复
    }
  }

  function create(id: string): PluginCache {
    const file = fileOf(id)
    let entries: Map<string, Entry> | undefined
    const all = (): Map<string, Entry> => (entries ??= load(file))
    return {
      get(key) {
        const entry = all().get(String(key))
        if (!entry) return undefined
        if (now() - entry.at >= ttl) {
          all().delete(String(key))
          return undefined
        }
        return entry.value
      },
      set(key, value) {
        let json: string | undefined
        try {
          json = JSON.stringify(value)
        } catch {
          json = undefined
        }
        all().set(String(key), { value, at: now(), json })
        persist(file, all())
      },
      remove(key) {
        if (all().delete(String(key))) persist(file, all())
      },
    }
  }

  return {
    forPlugin(pluginUrl) {
      const id = pluginStorageId(pluginUrl)
      let cache = caches.get(id)
      if (!cache) caches.set(id, (cache = create(id)))
      return cache
    },
  }
}
