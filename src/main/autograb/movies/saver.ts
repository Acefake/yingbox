/**
 * 电影追踪 · 转存与入库跟进：只存候选那一个文件到电影文件夹下这部片的子文件夹（同名已在就不再存）；分享失效时去掉这个候选、
 * 都没了就回到每天搜；转存 10 分钟后还没入库按 115 路径主动通知媒体库一次，一天后还没有就报错。
 */
import type { GrabResult } from '../../../shared/contract/autograb-upgrade'
import { isDeadShare } from '../finder'
import type { Gate } from '../gate'
import { localDate } from '../schedule-rules'
import { transferOne } from '../upgrade/transfer'
import { movieNextTry } from './movie-rules'
import type { MoviesDeps } from './service'
import type { MovieRecord } from './state'

const NOTIFY_AFTER_MS = 10 * 60_000
const STALE_AFTER_MS = 24 * 3_600_000

/** 转存要的上下文 */
export interface MovieSaverContext {
  deps: Pick<MoviesDeps, 'gate' | 'pan' | 'notify' | 'now' | 'log'>
  /** 这部电影存到哪个 cid（见 movieTarget）；解析不出时抛错 */
  targetCid(record: MovieRecord): Promise<string>
  dirty(): void
}

/**
 * 电影的转存目标：电影文件夹（单独选的或电影默认目录）下的「片名 (年份)」子文件夹，没有就建；
 * 不再平铺进电影文件夹（ADR-0029）。
 * @param base 电影文件夹 cid
 */
export function movieTarget(
  deps: Pick<MoviesDeps, 'gate' | 'pan' | 'folderName'>,
  base: () => string
): (record: MovieRecord) => Promise<string> {
  return async record => {
    const name = await deps.folderName(record)
    if (!name) throw new Error('算不出这部电影的文件夹名')
    const gate = await deps.gate()
    return gate.run('snap', () => deps.pan.childFolder(base(), name))
  }
}

/** 创建转存器 */
export function createMovieSaver(ctx: MovieSaverContext): {
  grab(record: MovieRecord, index: number): Promise<GrabResult>
  followSaved(record: MovieRecord, now: number, gate: Gate): Promise<void>
} {
  const { deps } = ctx
  return {
    async grab(record, index) {
      if (record.status === 'saved' || record.status === 'done')
        return { ok: true }
      const candidate = record.candidates[index]
      if (!candidate) return { ok: false, error: '候选不存在，请重新搜索' }
      let cid = ''
      try {
        cid = await ctx.targetCid(record)
        const gate = await deps.gate()
        await transferOne(gate, deps.pan, candidate, cid)
        const names = await gate.run('snap', () => deps.pan.names(cid))
        if (!names.includes(candidate.fileName))
          throw new Error('所选目录中未找到文件，请核对 115 转存位置后重试')
      } catch (error) {
        const message = (error as Error).message
        if (isDeadShare(error)) {
          record.candidates.splice(index, 1)
          if (!record.candidates.length) {
            const now = deps.now()
            record.nextTry = movieNextTry(
              record.searchFrom ?? localDate(now),
              now
            )
            record.status = record.nextTry === null ? 'notFound' : 'searching'
          }
        }
        record.error = `转存失败：${message}`
        ctx.dirty()
        return { ok: false, error: message }
      }
      Object.assign(record, {
        status: 'saved',
        savedAt: deps.now(),
        savedName: candidate.fileName,
        savedCid: cid,
        notified: false,
        error: null,
        nextTry: null,
      })
      deps.log(`已转存电影 ${record.title}：${candidate.fileName}`)
      ctx.dirty()
      return { ok: true }
    },

    async followSaved(record, now, gate) {
      const cid = record.savedCid
      if (record.savedAt === null || !cid) return
      if (!record.notified && now - record.savedAt >= NOTIFY_AFTER_MS) {
        record.notified = true
        ctx.dirty()
        const dirs = await gate.run('snap', () => deps.pan.dirPath(cid))
        await deps.notify(`/${[...dirs, record.savedName ?? ''].join('/')}`)
      } else if (now - record.savedAt >= STALE_AFTER_MS && !record.error) {
        record.error = '已转存一天仍没入库：检查电影文件夹是否在媒体库里'
        ctx.dirty()
      }
    },
  }
}
