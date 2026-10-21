/**
 * gfriends（github.com/gfriends/gfriends）：社区维护的女优头像仓库，只有头像没有资料。
 *
 * 仓库根下的 Filetree.json（约 6.5 MB、十万余条）是全部头像的索引：
 * Content/<来源目录>/<演员名>.jpg → 实际文件名（常是「AI-Fix-<名>.jpg?t=…」）。
 * 索引只拉一次：同一个来源对象内并发查询共享同一个加载中的 Promise，
 * 拉到后压成「文件名 → 相对路径」常驻内存；可选注入 store 持久化（默认 7 天过期），重启不必重下。
 * 来源目录按名字字母序遍历，同名先到先得（z- 开头的低质来源排在后面）。
 * 行为参考 Amane 的 gfriends 演员爬虫，代码独立实现。
 */
import { normalizeName } from '../names'
import type { ActorContext, ActorProfile, ActorSource } from '../types'

export const GFRIENDS_REPO = 'https://github.com/gfriends/gfriends'
export const GFRIENDS_RAW =
  'https://raw.githubusercontent.com/gfriends/gfriends/master'

const DAY = 86_400_000
const EXTENSIONS = ['.jpg', '.png', '.JPG', '.PNG'] as const

/** 压缩后的索引：文件名（演员名 + 扩展名）→ 仓库内相对路径 Content/<目录>/<文件>。 */
export type GfriendsIndex = Map<string, string>

/** 持久化的索引快照。 */
export interface GfriendsSnapshot {
  fetchedAt: number
  entries: Record<string, string>
}

/** 索引持久化（主进程可用 userData 下的一个 JSON 文件实现）。 */
export interface GfriendsStore {
  load(): Promise<GfriendsSnapshot | null>
  save(snapshot: GfriendsSnapshot): Promise<void>
}

export interface GfriendsOptions {
  /** 原始文件地址前缀，可换成镜像（如 jsDelivr 的 https://cdn.jsdelivr.net/gh/gfriends/gfriends@master）。 */
  rawBase?: string
  store?: GfriendsStore
  /** 持久化索引的有效期，默认 7 天。 */
  maxAgeMs?: number
  now?: () => number
}

/** Filetree.json → 压缩索引。坏数据返回空索引。 */
export function flattenFiletree(tree: unknown): GfriendsIndex {
  const out: GfriendsIndex = new Map()
  const content = (tree as { Content?: unknown } | null)?.Content
  if (!content || typeof content !== 'object') return out
  const folders = content as Record<string, unknown>
  for (const folder of Object.keys(folders).sort()) {
    const files = folders[folder]
    if (!files || typeof files !== 'object') continue
    for (const [file, value] of Object.entries(files)) {
      if (out.has(file)) continue
      const target =
        typeof value === 'string' && value ? value.split('?')[0] : file
      out.set(file, `Content/${folder}/${target}`)
    }
  }
  return out
}

/** 按演员名查索引：原写法优先，再试 NFKC 归一写法；依次试 .jpg / .png。 */
export function lookupGfriends(
  index: GfriendsIndex,
  name: string
): string | undefined {
  const names = [...new Set([name.trim(), normalizeName(name)])]
  for (const n of names) {
    for (const ext of EXTENSIONS) {
      const path = index.get(`${n}${ext}`)
      if (path) return path
    }
  }
  return undefined
}

/** 相对路径 → 地址（每段单独编码）。 */
export function gfriendsUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** 创建 gfriends 来源。每个来源对象自带一份索引缓存，应用内应只建一个。 */
export function createGfriendsSource(
  options: GfriendsOptions = {}
): ActorSource {
  const rawBase = options.rawBase ?? GFRIENDS_RAW
  const maxAge = options.maxAgeMs ?? 7 * DAY
  const now = options.now ?? Date.now
  let loading: Promise<GfriendsIndex> | undefined

  async function download(ctx: ActorContext): Promise<GfriendsIndex> {
    const cached = await options.store?.load().catch(() => null)
    if (cached && now() - cached.fetchedAt < maxAge)
      return new Map(Object.entries(cached.entries))
    let index: GfriendsIndex
    try {
      const text = await ctx.page(`${rawBase}/Filetree.json`)
      if (text === null)
        throw new Error('gfriends 索引不存在（Filetree.json 404）')
      index = flattenFiletree(JSON.parse(text))
    } catch (error) {
      // 拉不到新索引时，过期的快照也比没有强
      if (cached) return new Map(Object.entries(cached.entries))
      throw error
    }
    await options.store
      ?.save({ fetchedAt: now(), entries: Object.fromEntries(index) })
      .catch(() => {})
    return index
  }

  /** 拉一次索引；失败时清掉，下次查询重试。 */
  function ensureIndex(ctx: ActorContext): Promise<GfriendsIndex> {
    loading ??= download(ctx).catch(error => {
      loading = undefined
      throw error
    })
    return loading
  }

  return {
    id: 'gfriends',
    label: 'gfriends',
    capability: 'image',
    genders: ['female'],
    async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
      if (!name.trim()) return null
      const path = lookupGfriends(await ensureIndex(ctx), name)
      if (!path) return null
      return {
        source: 'gfriends',
        name: normalizeName(name),
        aliases: [],
        images: [gfriendsUrl(rawBase, path)],
        ids: { gfriends: name },
        url: gfriendsUrl(`${GFRIENDS_REPO}/blob/master`, path),
      }
    },
  }
}
