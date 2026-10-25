/**
 * 洗版 · 替换与删旧文件：
 * - 替换：认出旧文件所在的 115 文件夹（结果缓存；认不出或核对不上就要用户选），只存候选那一个文件进去，
 *   旧文件不动；分享失效时去掉这个候选，都没了就一周后再搜；
 * - 删旧文件：只在已有新版、并且新文件已在本地挂载里时，经本地挂载删除旧文件，再通知媒体库。
 */
import type { GrabResult } from '../../../shared/contract/autograb-upgrade'
import { isDeadShare } from '../finder'
import type { Gate } from '../gate'
import { baseOf, dirOf, joinPath, resolveFolderCid } from './folder-path'
import { UPGRADE_INTERVAL_MS } from './quality-rules'
import type { UpgradeDeps } from './service'
import type { UpgradeRecord, UpgradeState } from './state'
import { transferOne } from './transfer'

/** 替换的结果：认不出 115 文件夹时要用户选 */
export type ReplaceResult =
  | GrabResult
  | { ok: false; error: string; needFolder: true }

const NEED_FOLDER = {
  ok: false as const,
  error: '认不出旧文件在 115 上的文件夹，请选一个',
  needFolder: true as const,
}

/** 替换要的上下文 */
export interface ReplaceContext {
  state(): UpgradeState
  deps: Pick<
    UpgradeDeps,
    'pan' | 'mountRoot' | 'fileExists' | 'removeFile' | 'notify' | 'now' | 'log'
  >
  dirty(): void
}

/** 创建替换器 */
export function createReplacer(ctx: ReplaceContext): {
  replace(
    record: UpgradeRecord,
    index: number,
    gate: Gate,
    picked?: string
  ): Promise<ReplaceResult>
  deleteOld(record: UpgradeRecord): Promise<GrabResult>
} {
  const { deps } = ctx

  async function folderOf(dir: string, gate: Gate): Promise<string | null> {
    const cache = ctx.state().dirCids
    if (cache[dir]) return cache[dir]
    const cid = await resolveFolderCid(dir, deps.mountRoot(), cid =>
      gate.run('snap', () => deps.pan.dirs(cid))
    )
    if (cid) cache[dir] = cid
    return cid
  }

  return {
    async replace(record, index, gate, picked) {
      if (record.status === 'saved' || record.status === 'replaced')
        return { ok: true }
      const candidate = record.candidates[index]
      if (!candidate) return { ok: false, error: '候选不存在，请重新搜索' }
      const dir = dirOf(record.filePath)
      const cache = ctx.state().dirCids
      try {
        const cid = picked ?? (await folderOf(dir, gate))
        if (!cid) return NEED_FOLDER
        const outcome = await transferOne(
          gate,
          deps.pan,
          candidate,
          cid,
          baseOf(record.filePath)
        )
        if (outcome === 'mismatch') {
          delete cache[dir]
          ctx.dirty()
          return NEED_FOLDER
        }
        cache[dir] = cid
        Object.assign(record, {
          status: 'saved',
          savedAt: deps.now(),
          savedName: candidate.fileName,
          savedCid: cid,
          error: null,
        })
        deps.log(`洗版已转存 ${record.title}：${candidate.fileName}`)
        ctx.dirty()
        return { ok: true }
      } catch (error) {
        const message = (error as Error).message
        if (isDeadShare(error)) {
          record.candidates.splice(index, 1)
          if (!record.candidates.length) {
            record.status = 'waiting'
            record.nextTry = deps.now() + UPGRADE_INTERVAL_MS
          }
        }
        record.error = `转存失败：${message}`
        ctx.dirty()
        return { ok: false, error: message }
      }
    },

    async deleteOld(record) {
      if (record.status !== 'replaced' || !record.savedName)
        return { ok: false, error: '只有已有新版的文件才能删旧文件' }
      const fresh = joinPath(dirOf(record.filePath), record.savedName)
      if (!(await deps.fileExists(fresh)))
        return { ok: false, error: '新文件还不在本地，先不删旧文件' }
      try {
        await deps.removeFile(record.filePath)
      } catch (error) {
        return { ok: false, error: `删除失败：${(error as Error).message}` }
      }
      record.status = 'cleaned'
      ctx.dirty()
      await deps.notify([record.filePath]).catch(() => {})
      return { ok: true }
    },
  }
}
