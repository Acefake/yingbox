/**
 * 写出层的纯规则：任务载荷与优先级、写出合并、整理计划 → 执行步骤、批次收尾状态、
 * 预览计划过期、进度节流、路径变化事件。不碰数据库与文件系统，供 writer-module / writer-jobs 单测共用。
 */
import type {
  ItemsChangedEvent,
  OrganizeBatchState,
} from '../../../shared/library/ipc'
import type { FollowupSpec } from '../jobs/followups'
import type { PlannedMove } from './organize/organize-planner'
import type { OrganizeCounts } from './organize/organize-runner'
import type { OrganizeOp } from './writer-store'

/** 任务优先级：用户点的写出 / 整理 > 识别后自动写出。 */
export const PRIORITY = { user: 12, auto: 2, organize: 18 } as const
/** 预览计划的有效期。 */
export const PLAN_TTL_MS = 30 * 60_000
/** 进度事件最小间隔。 */
export const PROGRESS_INTERVAL_MS = 250
/** 同时写出的条目数（每个条目内部按顺序写）。 */
export const WRITE_CONCURRENCY = 4

/** writer-write 任务载荷。 */
export interface WritePayload {
  itemIds: number[]
}
/** writer-organize / writer-undo 任务载荷。 */
export interface BatchPayload {
  batchId: number
}

/** 合并排队中的写出：条目取并集。 */
/** writer-write 任务（全局一个键，排队中的条目取并集）。 */
export const writeJobSpec = (
  itemIds: number[],
  priority: number
): FollowupSpec => ({
  type: 'writer-write',
  key: 'writer-write',
  payload: { itemIds } satisfies WritePayload,
  priority,
})

export const mergeWritePayload = (a: unknown, b: unknown): WritePayload => ({
  itemIds: [
    ...new Set([
      ...(a as WritePayload).itemIds,
      ...(b as WritePayload).itemIds,
    ]),
  ],
})

/** 整理执行顺序：先视频，再附属文件，最后文件夹。 */
const KIND_ORDER = { video: 0, sidecar: 1, folder: 2 } as const

/**
 * 预览计划 → 执行步骤：去掉有冲突的项，按 视频 → 附属文件 → 文件夹 排序（同类保持原顺序）。
 * 返回步骤和涉及的条目（去重、按首次出现顺序）。
 */
export function organizeOps(moves: PlannedMove[]): {
  ops: Array<Omit<OrganizeOp, 'seq' | 'state'>>
  itemIds: number[]
} {
  const runnable = moves.filter(m => !m.conflict)
  const ops = [...runnable]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .map(m => ({
      itemId: m.itemId,
      libraryId: m.libraryId,
      kind: m.kind,
      src: m.from,
      dst: m.to,
      crossDevice: m.crossDevice,
    }))
  return { ops, itemIds: [...new Set(runnable.map(m => m.itemId))] }
}

/** 只有执行完的批次（成功 / 部分成功 / 失败）可以撤销。 */
export const canUndo = (state: OrganizeBatchState): boolean =>
  state === 'done' || state === 'partial' || state === 'failed'

/** 整理结束后的批次状态：全成功 done；有失败但移动过 partial；一个都没移动 failed。 */
export function organizeFinalState(
  counts: Pick<OrganizeCounts, 'failed' | 'moved'>
): OrganizeBatchState {
  if (!counts.failed) return 'done'
  return counts.moved ? 'partial' : 'failed'
}

/** 撤销结束后的批次状态：有失败 partial，否则 undone。 */
export const undoFinalState = (
  counts: Pick<OrganizeCounts, 'failed'>
): OrganizeBatchState => (counts.failed ? 'partial' : 'undone')

/** 已过期的预览计划 id（创建超过 ttl 毫秒）。 */
export function expiredPlans(
  plans: Map<string, { createdAt: number }>,
  now: number,
  ttl = PLAN_TTL_MS
): string[] {
  return [...plans].filter(([, p]) => now - p.createdAt > ttl).map(([id]) => id)
}

/**
 * 节流：返回的函数在 finished 为 true 时总是放行，否则距上次放行不足 interval 时丢弃。
 * 放行时调用 send 并记录时间。
 */
export function throttled<T>(
  send: (value: T, finished: boolean) => void,
  now: () => number = Date.now,
  interval = PROGRESS_INTERVAL_MS
): (value: T, finished: boolean) => void {
  let last = 0
  return (value, finished) => {
    const t = now()
    if (!finished && t - last < interval) return
    last = t
    send(value, finished)
  }
}

/** 整理计数 → writer-progress 的计数字段（moved 记作 written）。 */
export function organizeProgress(c: OrganizeCounts): {
  total: number
  done: number
  written: number
  skipped: number
  failed: number
} {
  return {
    total: c.total,
    done: c.done,
    written: c.moved,
    skipped: c.skipped,
    failed: c.failed,
  }
}

/** 路径变化后的 items-changed 事件：按媒体库分组，查不到库的条目丢弃。 */
export function itemsUpdatedEvents(
  itemIds: number[],
  libraryOf: (id: number) => number | undefined
): ItemsChangedEvent[] {
  const byLibrary = new Map<number, number[]>()
  for (const id of itemIds) {
    const lib = libraryOf(id)
    if (lib !== undefined)
      byLibrary.set(lib, [...(byLibrary.get(lib) ?? []), id])
  }
  return [...byLibrary].map(([libraryId, updated]) => ({
    type: 'items-changed',
    libraryId,
    added: [],
    updated,
    removed: [],
    reset: false,
  }))
}
