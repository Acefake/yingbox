/**
 * 媒体库服务的纯规则：任务载荷与优先级、扫描载荷合并、items-changed 事件（超量时改为整体重置）、
 * 指纹分批。不碰数据库与文件系统，供 service / library-jobs 共用并单测。
 */
import {
  ITEMS_CHANGED_LIMIT,
  type ItemsChangedEvent,
} from '../../../shared/library/ipc'
import type { ItemChanges } from '../catalog/catalog-store'

/** 扫描任务载荷。 */
export interface ScanPayload {
  libraryId: number
  full?: boolean
  /** 只重读这些目录；缺省为整库扫描。 */
  dirs?: string[]
}

/** 解析 / 指纹任务载荷。 */
export interface LibraryPayload {
  libraryId: number
}

/** 任务优先级：用户手动扫描 > 监听触发 > 解析 > 指纹。 */
export const PRIORITY = {
  scan: 20,
  watch: 10,
  parse: 5,
  fingerprint: 0,
} as const
/** 指纹 / 解析任务每批处理的文件数。 */
export const BACKGROUND_BATCH = 500
/** 同时读取的文件数：每个读 128 KiB，网络盘上并发过高反而更慢。 */
export const FINGERPRINT_CONCURRENCY = 8
/** 一次扫描最多写进日志的告警条数。 */
export const SCAN_WARNING_LOG_LIMIT = 20

/** 合并两个扫描载荷：任何一方是整库扫描就是整库扫描，否则目录取并集。 */
export function mergeScanPayload(a: unknown, b: unknown): ScanPayload {
  const x = a as ScanPayload
  const y = b as ScanPayload
  const full = !!x.full || !!y.full
  if (!x.dirs || !y.dirs) return { libraryId: x.libraryId, full }
  return {
    libraryId: x.libraryId,
    full,
    dirs: [...new Set([...x.dirs, ...y.dirs])],
  }
}

/** 扫描任务的排队键：同一媒体库的扫描合并。 */
export const scanJobKey = (libraryId: number): string => `library:${libraryId}`

/**
 * 一个媒体库的 items-changed 事件；没有变化返回 null。
 * 变化条数超过 ITEMS_CHANGED_LIMIT 时只发 reset（订阅方整体重拉）。
 */
export function itemsChangedEvent(
  libraryId: number,
  changes: ItemChanges
): ItemsChangedEvent | null {
  if (changes.empty) return null
  const count = changes.added.size + changes.updated.size + changes.removed.size
  const reset = count > ITEMS_CHANGED_LIMIT
  return {
    type: 'items-changed',
    libraryId,
    added: reset ? [] : [...changes.added],
    updated: reset ? [] : [...changes.updated],
    removed: reset ? [] : [...changes.removed],
    reset,
  }
}

/** 按固定大小切块（最后一块可能不足）。size 必须为正。 */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
