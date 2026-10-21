/**
 * writer-auto-organize 任务：识别后自动整理。
 *
 * 与手动整理走同一条路（预览计划 → 去掉冲突项 → 记批次 → 按批次执行，可撤销），区别只是
 * 不等用户确认：只整理确定匹配（auto / locked）的条目，有冲突的项原样留下、只记日志。
 * 整理结束（无论成败）后为 writeAfter 里的条目排写出，NFO 与图片写到最终位置。
 */
import { transaction } from '../../db/database'
import type { LibraryDb } from '../../db/database'
import type { JobContext } from '../../jobs/queue'
import { type AutoOrganizePayload, canAutoOrganize } from '../auto-rules'
import { type WriterJobDeps, runBatch } from '../writer-jobs'
import { organizeOps } from '../writer-rules'
import { planOrganize } from './organize-planner'

/** 自动整理需要的额外能力。 */
export interface AutoOrganizeDeps extends WriterJobDeps {
  db: LibraryDb
  /** 设备号（测试注入以模拟跨盘）。 */
  deviceOf?: (path: string) => Promise<number | undefined>
  /** 排写出（自动优先级）。 */
  enqueueWrite: (itemIds: number[]) => void
}

/** 执行一次自动整理。 */
export async function runAutoOrganize(
  deps: AutoOrganizeDeps,
  payload: AutoOrganizePayload,
  ctx: JobContext
): Promise<void> {
  try {
    await organizeConfident(deps, payload.itemIds, ctx)
  } finally {
    if (payload.writeAfter.length && !ctx.signal.aborted) {
      deps.enqueueWrite(payload.writeAfter)
    }
  }
}

/** 规划并执行确定匹配条目的整理（全局「允许整理文件」关闭时什么都不做）。 */
async function organizeConfident(
  deps: AutoOrganizeDeps,
  itemIds: number[],
  ctx: JobContext
): Promise<void> {
  const settings = deps.settings()
  if (!settings.organize.enabled) return
  const top = deps.store.topLevelIds(itemIds).filter(id => {
    const node = deps.catalogQuery.getItem(id)
    return !!node && canAutoOrganize(node.matchState)
  })
  if (!top.length) return
  const preview = await planOrganize(top, settings, {
    getItem: id => deps.catalogQuery.getItem(id),
    library: id => deps.libraries.get(id),
    foreignVideos: (dir, id) => deps.store.foreignVideosIn(dir, id),
    deviceOf: deps.deviceOf,
  })
  ctx.signal.throwIfAborted()
  const conflicts = preview.moves.filter(m => m.conflict).length
  if (conflicts) {
    deps.log?.(
      `自动整理：${conflicts} 项有冲突未执行，可在海报墙里手动整理查看原因`
    )
  }
  const { ops, itemIds: moving } = organizeOps(preview.moves)
  if (!ops.length) return
  const batchId = transaction(deps.db, () =>
    deps.store.createBatch(moving, ops, Date.now())
  )
  await runBatch(deps, batchId, 'organize', ctx)
}
