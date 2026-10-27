/**
 * 115 目录树的状态：展开一个节点时才读它的子文件夹（懒加载），读过的结果按 cid 缓存，
 * 同一个节点并发展开只发一次请求；缓存默认全页共用（选择器关掉再打开不重读），超过 {@link TREE_TTL_MS} 后再展开会重读。
 * 树拍平成行（{@link FolderTreeRow}），组件只管按 depth 缩进渲染。
 */
import { type ComputedRef, computed, reactive, shallowRef } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type { Pan115Dir } from '../../../../../shared/contract/pan115'

import { errorText } from '../utils/netdisk-rules'

/** 缓存多久后展开时重读 */
export const TREE_TTL_MS = 5 * 60_000

/** 一个节点读到的子文件夹 */
interface CachedDirs {
  dirs: Pan115Dir[]
  truncated: boolean
  at: number
}

/** 子文件夹缓存（可跨组件实例共用） */
export interface FolderTreeCache {
  entries: Map<string, CachedDirs>
  pending: Map<string, Promise<void>>
}

/** 新建一份缓存（测试、或要和全页隔离时用） */
export function createFolderTreeCache(): FolderTreeCache {
  return { entries: new Map(), pending: new Map() }
}

const sharedCache = createFolderTreeCache()

/** 拍平后的一行：文件夹，或挂在展开节点下的说明（读取中 / 出错 / 空 / 截断） */
export type FolderTreeRow =
  | {
      type: 'dir'
      cid: string
      name: string
      depth: number
      expanded: boolean
      /** 读过且没有子文件夹（不再显示展开箭头） */
      leaf: boolean
    }
  | {
      type: 'note'
      key: string
      depth: number
      text: string
      tone: 'muted' | 'danger'
    }

/** 目录树的状态与动作 */
export interface FolderTree {
  rows: ComputedRef<FolderTreeRow[]>
  /** 展开 / 收起；展开时按需读取 */
  toggle(cid: string): Promise<void>
  /** 读一个节点的子文件夹（缓存新鲜时不发请求；force 时重读） */
  load(cid: string, force?: boolean): Promise<void>
  /** 首次打开：根目录展开并读取 */
  start(): Promise<void>
}

/** 依赖：pan115.dirs；cache / now 可替换（测试） */
export interface FolderTreeOptions {
  cache?: FolderTreeCache
  now?: () => number
}

const ROOT = '0'

export function useFolderTree(
  api: () => Pick<Api['pan115'], 'dirs'>,
  options: FolderTreeOptions = {}
): FolderTree {
  const cache = options.cache ?? sharedCache
  const now = options.now ?? Date.now
  const expanded = reactive(new Set<string>())
  const loading = reactive(new Set<string>())
  const errors = reactive(new Map<string, string>())
  /** 共用缓存不是响应式的：写入后拨一下版本号让 rows 重算 */
  const version = shallowRef(0)

  const fresh = (cid: string): boolean => {
    const hit = cache.entries.get(cid)
    return !!hit && now() - hit.at < TREE_TTL_MS
  }

  async function fetchDirs(cid: string): Promise<void> {
    let result: Awaited<ReturnType<Api['pan115']['dirs']>>
    try {
      result = await api().dirs(cid)
    } catch (e) {
      result = { ok: false, error: `读取文件夹失败：${errorText(e)}` }
    }
    if (!result.ok) throw new Error(result.error)
    cache.entries.set(cid, {
      dirs: result.dirs.map(({ cid: id, name }) => ({ cid: id, name })),
      truncated: result.truncated,
      at: now(),
    })
  }

  async function load(cid: string, force = false): Promise<void> {
    if (!force && fresh(cid)) return
    let task = cache.pending.get(cid)
    if (!task) {
      task = fetchDirs(cid).finally(() => cache.pending.delete(cid))
      cache.pending.set(cid, task)
    }
    loading.add(cid)
    errors.delete(cid)
    try {
      await task
    } catch (e) {
      errors.set(cid, (e as Error).message)
    } finally {
      loading.delete(cid)
      version.value++
    }
  }

  async function toggle(cid: string): Promise<void> {
    if (expanded.has(cid)) {
      expanded.delete(cid)
      return
    }
    expanded.add(cid)
    await load(cid)
  }

  async function start(): Promise<void> {
    expanded.add(ROOT)
    await load(ROOT)
  }

  /** 一个展开节点下面的行（递归） */
  function childRows(cid: string, depth: number, out: FolderTreeRow[]): void {
    const note = (text: string, tone: 'muted' | 'danger' = 'muted'): void =>
      void out.push({ type: 'note', key: `${cid}:note`, depth, text, tone })
    if (loading.has(cid)) return note('正在读取…')
    const error = errors.get(cid)
    if (error) return note(error, 'danger')
    const hit = cache.entries.get(cid)
    if (!hit) return
    if (!hit.dirs.length && !hit.truncated) return note('没有子文件夹')
    for (const dir of hit.dirs) {
      const open = expanded.has(dir.cid)
      const known = cache.entries.get(dir.cid)
      out.push({
        type: 'dir',
        cid: dir.cid,
        name: dir.name,
        depth,
        expanded: open,
        leaf: !!known && !known.dirs.length && !known.truncated,
      })
      if (open) childRows(dir.cid, depth + 1, out)
    }
    if (hit.truncated) note(`文件夹太多，只显示前 ${hit.dirs.length} 个`)
  }

  const rows = computed<FolderTreeRow[]>(() => {
    void version.value
    const open = expanded.has(ROOT)
    const out: FolderTreeRow[] = [
      {
        type: 'dir',
        cid: ROOT,
        name: '根目录',
        depth: 0,
        expanded: open,
        leaf: false,
      },
    ]
    if (open) childRows(ROOT, 1, out)
    return out
  })

  return { rows, toggle, load, start }
}
