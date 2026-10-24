/**
 * 前情提要的摘要缓存：分段摘要、整集摘要、前情提要都按键存一份文本。
 *
 * - 普通内容落盘（userData/recap/cache.json，原子写、串行），超过上限按最早写入淘汰；
 * - 私密板块的内容只放内存（persist=false），关掉应用就没了，不留在磁盘上。
 * 不依赖 Electron：读写由 index.ts 注入，测试可替换。
 */

/** 缓存依赖 */
export interface RecapCacheDeps {
  /** 读缓存文件；不存在时返回 null */
  read: () => Promise<string | null>
  write: (text: string) => Promise<void>
  /** 落盘条目上限（默认 3000） */
  maxEntries?: number
  now?: () => number
}

/** 摘要缓存 */
export interface RecapCache {
  get(key: string): Promise<string | undefined>
  /** persist 为 false 时只放内存（私密内容） */
  set(key: string, text: string, persist: boolean): Promise<void>
}

interface Entry {
  text: string
  at: number
}

const FILE_VERSION = 1

/** 解析缓存文件；格式不对时当作空缓存 */
export function parseCacheFile(text: string | null): Map<string, Entry> {
  const entries = new Map<string, Entry>()
  if (!text) return entries
  try {
    const data = JSON.parse(text) as { version?: number; entries?: unknown }
    if (data?.version !== FILE_VERSION || !data.entries) return entries
    for (const [key, value] of Object.entries(
      data.entries as Record<string, Partial<Entry>>
    )) {
      if (typeof value?.text === 'string' && typeof value.at === 'number')
        entries.set(key, { text: value.text, at: value.at })
    }
  } catch {
    // 损坏的缓存文件直接丢弃，下次写入时覆盖
  }
  return entries
}

/** 超过上限时淘汰最早写入的条目 */
export function pruneEntries(
  entries: Map<string, Entry>,
  max: number
): Map<string, Entry> {
  if (entries.size <= max) return entries
  const kept = [...entries].sort((a, b) => b[1].at - a[1].at).slice(0, max)
  return new Map(kept)
}

/** 创建摘要缓存 */
export function createRecapCache(deps: RecapCacheDeps): RecapCache {
  const max = deps.maxEntries ?? 3000
  const now = deps.now ?? Date.now
  const memory = new Map<string, string>()
  let loaded: Promise<Map<string, Entry>> | null = null
  let chain: Promise<unknown> = Promise.resolve()

  const load = (): Promise<Map<string, Entry>> => {
    loaded ??= deps
      .read()
      .catch(() => null)
      .then(parseCacheFile)
    return loaded
  }

  return {
    async get(key) {
      const hit = memory.get(key)
      if (hit !== undefined) return hit
      return (await load()).get(key)?.text
    },

    async set(key, text, persist) {
      if (!persist) {
        memory.set(key, text)
        return
      }
      const next = chain.then(async () => {
        const entries = pruneEntries(
          (await load()).set(key, { text, at: now() }),
          max
        )
        loaded = Promise.resolve(entries)
        await deps.write(
          JSON.stringify({
            version: FILE_VERSION,
            entries: Object.fromEntries(entries),
          })
        )
      })
      chain = next.catch(() => {})
      await next
    },
  }
}
