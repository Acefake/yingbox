/**
 * 渲染层的片库观看进度：片库数据库（progress.* RPC）的响应式缓存 + 上报队列。
 *
 * - 读：progressOf(itemId) 只读缓存（响应式）；详情页、开播前用 loadProgress / prepareProgress 把一部作品的进度读进来；
 * - 写：播放器经 progress/library-sink 上报，先按同一套规则（applyReport）改缓存，界面立即跟着变；
 *   上报攒 5 秒一批写进片库，切集 / 关播放器时立即写；写失败的留着下一批再写；
 * - 片库是唯一来源：桌面端写本机引擎，网页端写片库服务；桌面端同步拉下来新进度时（progressSync.applied）重读。
 * - 还在本地进度表 / 「已看完」集合里的媒体库进度：作品第一次读进来时，片库里没有的那几集搬进片库（legacy.ts）。
 */
import { shallowReactive } from 'vue'

import type {
  LibraryItemNode,
  ProgressReport,
  WatchProgress,
} from '../../../../../shared/library/ipc'
import {
  applyReport,
  reachedWatched,
} from '../../../../../shared/library/watch-progress'
import type { LibraryRef } from '@/features/player'

import { libraryBridge } from '../api/bridge'
import { legacyReports } from './legacy'

/** 上报攒多久写一批（毫秒）。 */
export const FLUSH_DELAY = 5000

/** itemId → 进度（只放读到过或上报过的） */
const cache = shallowReactive(new Map<number, WatchProgress>())
/** 还没写进片库的上报（同一条目只留最后一次，带发生时间） */
const pending = new Map<number, ProgressReport>()
/** 读过进度的顶层条目（同步拉下新进度时重读这些） */
const loadedRoots = new Set<number>()
/** 搬过老进度的顶层条目 */
const migrated = new Set<number>()
let timer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> | null = null
/** 进度写进片库后回调（海报墙概况据此重读） */
const savedListeners = new Set<() => void>()

/** 一个条目的进度（响应式）；没看过为 null。 */
export function progressOf(itemId: number): WatchProgress | null {
  return cache.get(itemId) ?? null
}

/** 续播位置（秒）：看完的从头（0）；没记录为 undefined。 */
export function resumeAt(ref: LibraryRef | undefined): number | undefined {
  const p = ref ? cache.get(ref.itemId) : undefined
  if (!p) return undefined
  return reachedWatched(p.position, p.duration) ? 0 : p.position
}

/** 把读到的进度并进缓存（还有没写出的上报的条目不覆盖：本地的更新）。 */
function absorb(list: readonly WatchProgress[]): void {
  for (const p of list) if (!pending.has(p.itemId)) cache.set(p.itemId, p)
}

/** 读这些条目（及其下属）的进度进缓存。没有片库 bridge 时不做。 */
export async function loadProgress(itemIds: readonly number[]): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge || !itemIds.length) return
  for (const id of itemIds) loadedRoots.add(id)
  absorb(await bridge.progress.list([...itemIds]))
}

/** 开播 / 打开详情前：读这部作品的进度，并把本地进度表里这部作品的进度搬一次进片库。读失败不拦播放。 */
export async function prepareProgress(item: LibraryItemNode): Promise<void> {
  try {
    await loadProgress([item.id])
    if (migrated.has(item.id)) return
    migrated.add(item.id)
    const reports = legacyReports(item, id => cache.has(id))
    if (reports.length) {
      for (const r of reports) queue(r)
      await flushProgress()
    }
  } catch (error) {
    console.warn('[library-progress] 读取进度失败', error)
  }
}

function queue(report: ProgressReport): void {
  const next = applyReport(cache.get(report.itemId) ?? null, report, Date.now())
  cache.set(report.itemId, next)
  pending.set(report.itemId, { ...report, at: next.updatedAt })
}

/** 播放器上报一次进度（改缓存，攒批写进片库）。 */
export function reportProgress(
  ref: LibraryRef,
  position: number,
  duration: number,
  ended: boolean
): void {
  queue({ itemId: ref.itemId, fileId: ref.fileId, position, duration, ended })
  if (ended) void flushProgress()
  else timer ??= setTimeout(() => void flushProgress(), FLUSH_DELAY)
}

/** 手动标记看完 / 未看。 */
export function markItemWatched(itemId: number, watched: boolean): void {
  const old = cache.get(itemId)
  queue({
    itemId,
    position: old?.position ?? 0,
    duration: old?.duration ?? 0,
    watched,
  })
  void flushProgress()
}

/** 立即写出攒着的上报；正在写时等它写完再写剩下的。 */
export async function flushProgress(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  while (writing) await writing
  const bridge = libraryBridge()
  if (!bridge || !pending.size) return
  const batch = [...pending.values()]
  pending.clear()
  writing = bridge.progress
    .save(batch)
    .then(saved => {
      absorb(saved)
      savedListeners.forEach(listener => listener())
    })
    .catch(error => {
      // 留着下一批再写（期间又有新上报的条目以新的为准）
      for (const r of batch)
        if (!pending.has(r.itemId)) pending.set(r.itemId, r)
      timer ??= setTimeout(() => void flushProgress(), FLUSH_DELAY * 6)
      console.warn('[library-progress] 写入进度失败', error)
    })
    .finally(() => (writing = null))
  await writing
}

/** 订阅「进度写进了片库」；返回取消订阅。 */
export function onProgressSaved(listener: () => void): () => void {
  savedListeners.add(listener)
  return () => savedListeners.delete(listener)
}

/** 同步拉下了新进度：重读读过的作品，并通知订阅方。 */
export async function reloadProgress(): Promise<void> {
  await loadProgress([...loadedRoots])
  savedListeners.forEach(listener => listener())
}

/** 测试用：清空缓存与队列。 */
export function resetProgressCache(): void {
  if (timer) clearTimeout(timer)
  timer = null
  cache.clear()
  pending.clear()
  loadedRoots.clear()
  migrated.clear()
}
