/**
 * 媒体库服务的纯规则：任务载荷与优先级、扫描载荷合并、items-changed 事件（超量时改为整体重置）、
 * 指纹分批。不碰数据库与文件系统，供 service / library-jobs 共用并单测。
 */
import {
  ITEMS_CHANGED_LIMIT,
  type ItemsChangedEvent,
} from '../../../shared/library/ipc'
import type { ItemChanges } from '../catalog/catalog-store'
import type { FollowupSpec } from '../jobs/followups'
import type { LibraryServiceOptions } from './service-options'

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

/** 任务优先级：用户手动扫描 > 监听触发 > 解析 > 指纹 / 动态范围探测。 */
export const PRIORITY = {
  scan: 20,
  watch: 10,
  parse: 5,
  fingerprint: 0,
  probe: 0,
} as const
/** 指纹 / 解析 / 动态范围探测任务每批处理的文件数。 */
export const BACKGROUND_BATCH = 500
/** 同时读取的文件数：每个读 128 KiB，网络盘上并发过高反而更慢；也不超过系统线程池（4 条）。 */
export const FINGERPRINT_CONCURRENCY = 3
/** 算不出指纹的文件隔多久再试：读不回来的文件不能每轮都重试，否则指纹任务永远清不完。 */
export const FINGERPRINT_RETRY_MS = 7 * 24 * 60 * 60 * 1000
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

/** 一个库的解析 / 指纹 / 动态范围探测任务（键 <类型>:<库>，同库合并）。 */
export const libraryJobSpec = (
  type: 'parse' | 'fingerprint' | 'probe',
  libraryId: number
): FollowupSpec => ({
  type,
  key: `${type}:${libraryId}`,
  payload: { libraryId } satisfies LibraryPayload,
  priority: PRIORITY[type],
})

/**
 * 存储判定完后本地盘的库要补排的读文件任务：宿主提供了 probeVideo 时补动态范围探测（启动时补上没探测过的），
 * fingerprint 时再补指纹（存储从网盘回到本地盘，补上按网盘处理期间跳过的）；网盘不补。
 */
export function backfillJobs(
  cloud: boolean,
  fingerprint: boolean,
  host: Pick<LibraryServiceOptions, 'probeVideo'>
): Array<'fingerprint' | 'probe'> {
  if (cloud) return []
  const jobs: Array<'fingerprint' | 'probe'> = fingerprint
    ? ['fingerprint']
    : []
  if (host.probeVideo) jobs.push('probe')
  return jobs
}

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
