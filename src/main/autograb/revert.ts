/**
 * 追更 · 撤销：把追更存进 115 的那一集删掉，记录回到缺集、这个候选以后不再用。
 *
 * 安全边界：
 * - 只删记录里的那一个文件 id（转存后列目标文件夹记下的，见 saver.ts）；没有记下 id 的记录（同名文件本来就在等）不能撤销；
 * - 删之前再列一次那个文件夹，按 id 找到文件，文件名和体积都和转存时一致才删，对不上就不动；
 * - 列目录、删除都经 115 闸门（删除和转存共用写操作限额）；
 * - 媒体库里那条本地记录不在这里改：发一条删除通知，交给片库下次刷新处理；刷新前日历里还挂着被删的文件，
 *   records.ts 按 revertedName 认出来，不会把这一集又记成已入库。
 */
import type { AutograbResult } from '../../shared/contract/autograb'
import type { Gate } from './gate'
import type { AutograbDeps } from './deps'
import type { EpisodeRecord } from './state'

/** 撤销需要的上下文 */
export interface RevertContext {
  gate(): Gate
  deps: Pick<AutograbDeps, 'pan' | 'notify' | 'now' | 'log'>
  dirty(): void
}

/** 这条记录能不能撤销 */
export function canRevert(record: EpisodeRecord): boolean {
  return (
    (record.status === 'saved' || record.status === 'done') &&
    record.savedFileId !== null &&
    record.savedCid !== null &&
    record.savedName !== null
  )
}

/** 撤销一集 */
export async function revertEpisode(
  ctx: RevertContext,
  record: EpisodeRecord
): Promise<AutograbResult> {
  if (record.status !== 'saved' && record.status !== 'done')
    return { ok: false, error: '这一集还没有转存' }
  if (!canRevert(record))
    return {
      ok: false,
      error: '这一集不是追更转存的或没有记下 115 文件 id，请在 115 里手动删除',
    }
  const cid = record.savedCid!
  const fileId = record.savedFileId!
  const name = record.savedName!
  const gate = ctx.gate()
  const entries = await gate.run('snap', () => ctx.deps.pan.entries(cid))
  const file = entries.find(e => !e.isDir && e.id === fileId)
  if (!file)
    return {
      ok: false,
      error: '115 文件夹里找不到这个文件（可能已移动或删除），没有删除任何东西',
    }
  if (
    file.name !== name ||
    (record.savedSize !== null && file.size !== record.savedSize)
  )
    return {
      ok: false,
      error: '115 里这个文件的名字或大小和转存时不一致，为安全起见没有删除',
    }
  await gate.run('delete', () => ctx.deps.pan.remove(cid, fileId))
  ctx.deps.log(
    `已撤销 ${record.seriesTitle} S${record.season}E${record.episode}：${name}`
  )

  if (record.savedFrom && !record.banned.includes(record.savedFrom))
    record.banned.push(record.savedFrom)
  record.candidates = []
  record.status = 'waiting'
  record.nextTry = ctx.deps.now()
  record.error = null
  record.revertedName = name
  record.savedAt = null
  record.savedName = null
  record.savedCid = null
  record.savedFileId = null
  record.savedSize = null
  record.savedFrom = null
  record.notified = false
  ctx.dirty()

  // 交给片库：按 115 路径发删除通知（失败不影响撤销结果，片库下次刷新也会发现）
  try {
    const dirs = await gate.run('snap', () => ctx.deps.pan.dirPath(cid))
    await ctx.deps.notify([
      { action: 'delete', path: `/${[...dirs, name].join('/')}` },
    ])
  } catch (error) {
    ctx.deps.log(`撤销后通知媒体库失败：${(error as Error).message}`)
  }
  return { ok: true }
}
