/**
 * 追更 · 转存与入库核对：把选中的候选只存那一个文件到这部剧的 115 文件夹，之后跟进到媒体库里出现这一集。
 *
 * - 转存前列目标文件夹，同名文件已在就不再转存（重启后不会重复存）；115 说「已经接收过」也算成功；
 * - 分享失效 / 提取码错：拉黑分享、去掉这个候选，没有候选了就回到等待、按计划再搜；
 * - 转存 {@link NOTIFY_AFTER_MS} 后仍没入库，按 115 路径主动通知媒体库扫一次（不靠 CloudDrive2 webhook）；
 *   {@link STALE_AFTER_MS} 后仍没有就在记录上报错，提示检查文件夹与媒体库的对应。
 */
import type { AutograbResult } from '../../shared/contract/autograb'
import { parseShareLink } from '../pan115/share-link'
import { isDeadShare } from './finder'
import type { Gate } from './gate'
import { nextTry } from './schedule-rules'
import { type AutograbDeps, BLOCK_MS } from './service'
import type { AutograbState, EpisodeRecord } from './state'

/** 转存后多久还没入库就主动通知媒体库 */
export const NOTIFY_AFTER_MS = 10 * 60_000
/** 转存后多久还没入库就报错 */
export const STALE_AFTER_MS = 24 * 3_600_000
/** 115 说「已经接收过」 */
export const ALREADY_RECEIVED = 4100024

/** 转存需要的上下文 */
export interface SaverContext {
  state(): AutograbState
  gate(): Gate
  deps: Pick<AutograbDeps, 'pan' | 'notify' | 'now' | 'log'>
  dirty(): void
  /** 这一集转存到哪个 cid */
  targetCid(record: EpisodeRecord): string
}

/** 创建转存器 */
export function createSaver(ctx: SaverContext): {
  grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult>
  followSaved(record: EpisodeRecord, now: number): Promise<void>
} {
  /** 转存一个候选；byUser 时算一次确认 */
  async function grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult> {
    if (record.status === 'saved' || record.status === 'done')
      return { ok: true }
    const candidate = record.candidates[index]
    if (!candidate) return { ok: false, error: '候选不存在，请重新搜索' }
    const setting = ctx.state().series[String(record.seriesId)]
    const cid = ctx.targetCid(record)
    try {
      const existing = await ctx
        .gate()
        .run('snap', () => ctx.deps.pan.names(cid))
      if (!existing.includes(candidate.fileName))
        await ctx
          .gate()
          .run('receive', () =>
            ctx.deps.pan.receive(
              candidate.shareUrl,
              candidate.password,
              [candidate.fileId],
              cid
            )
          )
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code !== ALREADY_RECEIVED) {
        const message = (error as Error).message
        if (isDeadShare(error)) {
          const ref = parseShareLink(candidate.shareUrl, candidate.password)
          if (ref)
            ctx.state().blacklist[ref.shareCode] = ctx.deps.now() + BLOCK_MS
          record.candidates.splice(index, 1)
          if (!record.candidates.length) {
            record.status = 'waiting'
            record.nextTry = nextTry(record.airDate, ctx.deps.now())
          }
        }
        record.error = `转存失败：${message}`
        ctx.dirty()
        return { ok: false, error: message }
      }
    }
    record.status = 'saved'
    record.savedAt = ctx.deps.now()
    record.savedName = candidate.fileName
    record.savedCid = cid
    record.notified = false
    record.error = null
    record.nextTry = null
    if (byUser && setting) setting.confirmed++
    ctx.deps.log(
      `已转存 ${record.seriesTitle} S${record.season}E${record.episode}：${candidate.fileName}`
    )
    ctx.dirty()
    return { ok: true }
  }

  /** 已转存的集：没入库就主动通知一次，太久没入库就报错 */
  async function followSaved(
    record: EpisodeRecord,
    now: number
  ): Promise<void> {
    if (record.savedAt === null) return
    if (
      !record.notified &&
      now - record.savedAt >= NOTIFY_AFTER_MS &&
      record.savedCid
    ) {
      record.notified = true
      ctx.dirty()
      const dirs = await ctx
        .gate()
        .run('snap', () => ctx.deps.pan.dirPath(record.savedCid!))
      const path = `/${[...dirs, record.savedName ?? ''].join('/')}`
      await ctx.deps.notify([{ action: 'create', path }])
    } else if (now - record.savedAt >= STALE_AFTER_MS && !record.error) {
      record.error = '已转存一天仍没入库：检查这部剧的 115 文件夹是否在媒体库里'
      ctx.dirty()
    }
  }

  return { grab, followSaved }
}
